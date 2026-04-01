import * as vscode from 'vscode';
import {
    CompiledFormat, compileAllFormats, matchesType, matchesMembers,
    extractImageInfo, ExtractedImageInfo
} from './format-descriptor';

// ---------------------------------------------------------------------------
//  MatInfo – the unified intermediate passed to webview
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
//  Format cache – refreshed from settings on each stopped event
// ---------------------------------------------------------------------------

let cachedFormats: CompiledFormat[] | null = null;

export function refreshFormats(): void {
    cachedFormats = null;
}

function getFormats(): CompiledFormat[] {
    if (!cachedFormats) {
        cachedFormats = compileAllFormats();
    }
    return cachedFormats;
}

// ---------------------------------------------------------------------------
//  Type quick-filter: does this variable potentially match any format?
// ---------------------------------------------------------------------------

export function mightBeImage(variable: any): boolean {
    if (!variable.variablesReference) {
        return false;
    }
    if (!variable.type) {
        return false;
    }
    return getFormats().some(fmt => matchesType(fmt, variable.type));
}

// ---------------------------------------------------------------------------
//  Expand children and try every format until one matches
// ---------------------------------------------------------------------------

function infoToMatInfo(info: ExtractedImageInfo): MatInfo {
    const cvType = info.cvDepth + ((info.channels - 1) << 3);
    return {
        flags: info.flags !== undefined ? info.flags : cvType,
        dims: 2,
        rows: info.rows,
        cols: info.cols,
        data: info.dataPtr,
        datastart: info.datastartPtr,
        dataend: info.dataendPtr,
        datalimit: info.dataendPtr,
        size: `${info.rows}x${info.cols}`,
        step: info.step
    };
}

export async function tryExpandAsImage(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<MatInfo | null> {
    let children: any[];
    try {
        const resp = await session.customRequest('variables', { variablesReference });
        if (!resp || !Array.isArray(resp.variables)) {
            return null;
        }
        children = resp.variables;
    } catch {
        return null;
    }

    for (const fmt of getFormats()) {
        if (!matchesMembers(fmt, children)) {
            continue;
        }
        try {
            const info = extractImageInfo(fmt, children);
            if (info) {
                console.log(`[ImageWatch] Matched format "${fmt.descriptor.name}" (${info.rows}x${info.cols})`);
                return infoToMatInfo(info);
            }
        } catch (err) {
            console.error(`[ImageWatch] Error extracting with format "${fmt.descriptor.name}":`, err);
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
//  Validate a pre-expanded variable list against any known format
// ---------------------------------------------------------------------------

export function tryParseAsImage(variables: any[]): MatInfo | null {
    for (const fmt of getFormats()) {
        if (!matchesMembers(fmt, variables)) {
            continue;
        }
        try {
            const info = extractImageInfo(fmt, variables);
            if (info) {
                return infoToMatInfo(info);
            }
        } catch (err) {
            console.error(`[ImageWatch] Error parsing with format "${fmt.descriptor.name}":`, err);
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
//  Read pixel memory via DAP
// ---------------------------------------------------------------------------

export async function readMatMemory(
    session: vscode.DebugSession,
    mat: MatInfo
): Promise<Uint8Array | null> {
    const count = mat.dataend.addr - mat.datastart.addr;
    if (count <= 0) {
        return null;
    }
    try {
        const resp = await session.customRequest('readMemory', {
            memoryReference: mat.datastart.hex,
            offset: 0,
            count
        });
        if (!resp || !resp.data) {
            return null;
        }
        return Uint8Array.from(Buffer.from(resp.data, 'base64'));
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
//  Enumerate all image variables in a scope
// ---------------------------------------------------------------------------

export async function findImagesInScope(
    session: vscode.DebugSession,
    scopeVariablesReference: number
): Promise<MatVariable[]> {
    refreshFormats();

    const formats = getFormats();
    console.log(`[ImageWatch] Loaded ${formats.length} format(s): ${formats.map(f => f.descriptor.name).join(', ')}`);

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

    console.log(`[ImageWatch] Found ${locals.length} local variable(s), checking types...`);

    const candidates = locals.filter(v => mightBeImage(v));

    console.log(`[ImageWatch] ${candidates.length} candidate(s) after type filter: ${candidates.map(v => `${v.name}(${v.type})`).join(', ')}`);

    const results: MatVariable[] = [];

    const tasks = candidates.map(async (v) => {
        const mat = await tryExpandAsImage(session, v.variablesReference);
        if (!mat) {
            console.log(`[ImageWatch] "${v.name}" expanded but no format matched`);
            return;
        }
        if (mat.rows <= 0 || mat.cols <= 0) {
            console.log(`[ImageWatch] "${v.name}" has invalid size ${mat.rows}x${mat.cols}`);
            return;
        }

        const memory = await readMatMemory(session, mat);
        if (!memory) {
            console.log(`[ImageWatch] "${v.name}" memory read failed`);
            return;
        }

        results.push({ name: v.name, mat, memory });
    });

    await Promise.allSettled(tasks);
    console.log(`[ImageWatch] ${results.length} image(s) found: ${results.map(r => r.name).join(', ')}`);
    return results;
}
