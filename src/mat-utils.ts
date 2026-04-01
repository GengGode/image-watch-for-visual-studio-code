import * as vscode from 'vscode';

export interface Ptr {
    addr: number;
    hex: string;
}

export interface MatInfo {
    flags: number;
    dims: number;
    rows: number;
    cols: number;
    data: Ptr;
    datastart: Ptr;
    dataend: Ptr;
    datalimit: Ptr;
    size: string;
    step: number[];
}

export interface MatVariable {
    name: string;
    mat: MatInfo;
    memory: Uint8Array;
}

const CV_MAT_FIELDS = [
    'flags', 'dims', 'rows', 'cols', 'data', 'datastart',
    'dataend', 'datalimit', 'allocator', 'u', 'size', 'step'
];

const MAT_TYPE_PATTERNS = [/\bMat\b/, /\bcv::Mat\b/, /\bMat_\b/];

export function isCvMatStructure(variables: any[]): boolean {
    if (!Array.isArray(variables) || variables.length !== 12) {
        return false;
    }
    return variables.every((v, i) => v.name === CV_MAT_FIELDS[i]);
}

export function mightBeCvMat(variable: any): boolean {
    if (!variable.variablesReference) {
        return false;
    }
    if (variable.type) {
        return MAT_TYPE_PATTERNS.some(p => p.test(variable.type));
    }
    return false;
}

function parseIntField(variable: any): number {
    if (variable.type !== 'int') {
        return 0;
    }
    return parseInt(variable.value);
}

function parsePtrField(variable: any): Ptr {
    if (variable.type !== 'unsigned char *' && variable.type !== 'const unsigned char *') {
        return { addr: 0, hex: '0x0000000000000000' };
    }
    const hex_value = variable.value.substr(0, 18);
    const decimal_value = parseInt(hex_value);
    return { addr: decimal_value, hex: hex_value };
}

function parseStepField(variable: any): number[] {
    const step_str = String(variable.value);
    const bufMatch = step_str.match(/buf=\S+\s*\{([^\}]*)\}/);
    let buf_array: number[] = [];
    if (bufMatch && bufMatch[1]) {
        buf_array = bufMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    }
    const firstMatch = step_str.match(/\{(\d+)\}/);
    if (firstMatch && firstMatch[1]) {
        if (buf_array.length === 0 || buf_array[0] !== parseInt(firstMatch[1])) {
            buf_array.unshift(parseInt(firstMatch[1]));
        }
    }
    return buf_array;
}

export function parseCvMat(variables: any[]): MatInfo {
    return {
        flags: parseIntField(variables[0]),
        dims: parseIntField(variables[1]),
        rows: parseIntField(variables[2]),
        cols: parseIntField(variables[3]),
        data: parsePtrField(variables[4]),
        datastart: parsePtrField(variables[5]),
        dataend: parsePtrField(variables[6]),
        datalimit: parsePtrField(variables[7]),
        size: variables[10].value,
        step: parseStepField(variables[11])
    };
}

export async function readMatMemory(session: vscode.DebugSession, mat: MatInfo): Promise<Uint8Array | null> {
    const count = mat.dataend.addr - mat.datastart.addr;
    if (count <= 0) {
        return null;
    }
    try {
        const resp = await session.customRequest('readMemory', {
            memoryReference: mat.datastart.hex,
            offset: 0,
            count: count
        });
        if (!resp || !resp.data) {
            return null;
        }
        return Uint8Array.from(Buffer.from(resp.data, 'base64'));
    } catch {
        return null;
    }
}

export async function tryExpandAsCvMat(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<MatInfo | null> {
    try {
        const resp = await session.customRequest('variables', { variablesReference });
        if (!resp || !Array.isArray(resp.variables)) {
            return null;
        }
        if (!isCvMatStructure(resp.variables)) {
            return null;
        }
        return parseCvMat(resp.variables);
    } catch {
        return null;
    }
}

export async function findCvMatsInScope(
    session: vscode.DebugSession,
    scopeVariablesReference: number
): Promise<MatVariable[]> {
    let locals: any[];
    try {
        const resp = await session.customRequest('variables', {
            variablesReference: scopeVariablesReference
        });
        if (!resp || !Array.isArray(resp.variables)) {
            return [];
        }
        locals = resp.variables;
    } catch {
        return [];
    }

    const candidates = locals.filter(v => mightBeCvMat(v));

    const results: MatVariable[] = [];
    const expandTasks = candidates.map(async (v) => {
        const mat = await tryExpandAsCvMat(session, v.variablesReference);
        if (!mat) { return; }
        if (mat.rows <= 0 || mat.cols <= 0) { return; }

        const memory = await readMatMemory(session, mat);
        if (!memory) { return; }

        results.push({ name: v.name, mat, memory });
    });

    await Promise.allSettled(expandTasks);
    return results;
}
