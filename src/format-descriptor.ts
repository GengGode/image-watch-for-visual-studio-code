import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
//  Public types – used by settings schema and runtime engine
// ---------------------------------------------------------------------------

export interface DepthMappingFromField {
    field: string;
    interpret: 'opencv' | 'byteSize' | 'byteSizeInt';
}

export interface DepthMappingCustom {
    field: string;
    map: Record<string, number>;
}

export interface DepthMappingFromFlags {
    fromFlags: string;
    mask: number;
}

export interface DepthMappingFixed {
    value: number;
}

export type DepthMapping =
    | string
    | DepthMappingFromField
    | DepthMappingCustom
    | DepthMappingFromFlags
    | DepthMappingFixed;

export interface ChannelMappingFromFlags {
    fromFlags: string;
    shift: number;
    mask: number;
    offset: number;
}

export interface ChannelMappingFixed {
    value: number;
}

export type ChannelMapping = string | ChannelMappingFromFlags | ChannelMappingFixed;

export interface StepMappingOpenCV {
    field: string;
    interpret: 'opencvStep';
}

export type StepMapping = string | StepMappingOpenCV;

export interface FieldMapping {
    rows: string;
    cols: string;
    channels: ChannelMapping;
    depth: DepthMapping;
    data: string;
    step: StepMapping;
}

export interface ImageFormatDescriptor {
    name: string;
    typePattern: string;
    members: string[];
    mapping: FieldMapping;
    memorySize: string;
}

// ---------------------------------------------------------------------------
//  Built-in format: cv::Mat
// ---------------------------------------------------------------------------

export const BUILTIN_CV_MAT: ImageFormatDescriptor = {
    name: 'cv::Mat',
    typePattern: '\\bMat\\b|\\bcv::Mat\\b|\\bMat_\\b',
    members: [
        'flags', 'dims', 'rows', 'cols', 'data', 'datastart',
        'dataend', 'datalimit', 'allocator', 'u', 'size', 'step'
    ],
    mapping: {
        rows: 'rows',
        cols: 'cols',
        channels: { fromFlags: 'flags', shift: 3, mask: 63, offset: 1 },
        depth: { fromFlags: 'flags', mask: 7 },
        data: 'data',
        step: { field: 'step', interpret: 'opencvStep' }
    },
    memorySize: 'dataend - datastart'
};

// ---------------------------------------------------------------------------
//  Read all descriptors (built-in + user settings)
// ---------------------------------------------------------------------------

export function getAllFormats(): ImageFormatDescriptor[] {
    const custom = vscode.workspace
        .getConfiguration('imageWatch')
        .get<ImageFormatDescriptor[]>('customFormats', []);
    return [BUILTIN_CV_MAT, ...custom];
}

// ---------------------------------------------------------------------------
//  Compiled runtime descriptor (regex pre-compiled, member set cached)
// ---------------------------------------------------------------------------

export interface CompiledFormat {
    descriptor: ImageFormatDescriptor;
    typeRegex: RegExp;
    memberSet: Set<string>;
}

export function compileFormat(desc: ImageFormatDescriptor): CompiledFormat | null {
    try {
        return {
            descriptor: desc,
            typeRegex: new RegExp(desc.typePattern),
            memberSet: new Set(desc.members)
        };
    } catch {
        console.warn(`[ImageWatch] Invalid typePattern in format "${desc.name}": ${desc.typePattern}`);
        return null;
    }
}

export function compileAllFormats(): CompiledFormat[] {
    return getAllFormats()
        .map(compileFormat)
        .filter((c): c is CompiledFormat => c !== null);
}

// ---------------------------------------------------------------------------
//  Matching helpers
// ---------------------------------------------------------------------------

export function matchesType(fmt: CompiledFormat, typeStr: string): boolean {
    return fmt.typeRegex.test(typeStr);
}

export function matchesMembers(fmt: CompiledFormat, variables: any[]): boolean {
    if (variables.length !== fmt.descriptor.members.length) {
        return false;
    }
    return variables.every((v, i) => v.name === fmt.descriptor.members[i]);
}

// ---------------------------------------------------------------------------
//  Field extraction engine
// ---------------------------------------------------------------------------

interface Ptr {
    addr: number;
    hex: string;
}

function parseAnyPointer(variable: any): Ptr {
    const str = String(variable.value);
    const match = str.match(/0x[0-9a-fA-F]+/);
    if (!match) {
        return { addr: 0, hex: '0x0000000000000000' };
    }
    const raw = match[0];
    const hex = raw.length < 18
        ? '0x' + raw.slice(2).padStart(16, '0')
        : raw.substring(0, 18);
    return { addr: parseInt(hex), hex };
}

function parseIntValue(variable: any): number {
    return parseInt(String(variable.value)) || 0;
}

function parseSizeT(variable: any): number {
    const str = String(variable.value);
    const num = parseInt(str);
    return isNaN(num) ? 0 : num;
}

function parseOpenCVStep(variable: any): number[] {
    const step_str = String(variable.value);
    const bufMatch = step_str.match(/buf=\S+\s*\{([^}]*)\}/);
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

function byteSizeToCvDepth(byteSize: number, preferFloat: boolean): number {
    switch (byteSize) {
        case 1: return 0;  // CV_8U
        case 2: return 2;  // CV_16U
        case 4: return preferFloat ? 5 : 4;  // CV_32F or CV_32S
        case 8: return 6;  // CV_64F
        default: return 0;
    }
}

function findMember(variables: any[], name: string): any | undefined {
    return variables.find(v => v.name === name);
}

export interface ExtractedImageInfo {
    rows: number;
    cols: number;
    channels: number;
    cvDepth: number;
    dataPtr: Ptr;
    step: number[];
    memorySize: number;
    flags: number;
    datastartPtr: Ptr;
    dataendPtr: Ptr;
}

function resolveDepth(mapping: DepthMapping, variables: any[]): number {
    if (typeof mapping === 'string') {
        const m = findMember(variables, mapping);
        return m ? parseIntValue(m) : 0;
    }
    if ('value' in mapping) {
        return (mapping as DepthMappingFixed).value;
    }
    if ('fromFlags' in mapping) {
        const fm = mapping as DepthMappingFromFlags;
        const flagsVar = findMember(variables, fm.fromFlags);
        if (!flagsVar) { return 0; }
        return parseIntValue(flagsVar) & fm.mask;
    }
    if ('interpret' in mapping) {
        const dm = mapping as DepthMappingFromField;
        const m = findMember(variables, dm.field);
        if (!m) { return 0; }
        const val = parseIntValue(m);
        switch (dm.interpret) {
            case 'opencv': return val;
            case 'byteSize': return byteSizeToCvDepth(val, true);
            case 'byteSizeInt': return byteSizeToCvDepth(val, false);
        }
    }
    if ('map' in mapping) {
        const cm = mapping as DepthMappingCustom;
        const m = findMember(variables, cm.field);
        if (!m) { return 0; }
        const key = String(parseIntValue(m));
        return cm.map[key] ?? 0;
    }
    return 0;
}

function resolveChannels(mapping: ChannelMapping, variables: any[]): number {
    if (typeof mapping === 'string') {
        const m = findMember(variables, mapping);
        return m ? parseIntValue(m) : 1;
    }
    if ('value' in mapping) {
        return (mapping as ChannelMappingFixed).value;
    }
    if ('fromFlags' in mapping) {
        const fm = mapping as ChannelMappingFromFlags;
        const flagsVar = findMember(variables, fm.fromFlags);
        if (!flagsVar) { return 1; }
        return ((parseIntValue(flagsVar) >> fm.shift) & fm.mask) + fm.offset;
    }
    return 1;
}

function resolveStep(mapping: StepMapping, variables: any[]): number[] {
    if (typeof mapping === 'string') {
        const m = findMember(variables, mapping);
        if (!m) { return [0]; }
        return [parseSizeT(m)];
    }
    if ('interpret' in mapping) {
        const sm = mapping as StepMappingOpenCV;
        const m = findMember(variables, sm.field);
        if (!m) { return [0]; }
        return parseOpenCVStep(m);
    }
    return [0];
}

function evalSimpleExpr(expr: string, vars: Record<string, number>): number {
    const tokens = expr.replace(/([+\-*()])/g, ' $1 ').split(/\s+/).filter(Boolean);
    const output: (number | string)[] = [];
    const ops: string[] = [];
    const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2 };

    function applyOp() {
        const op = ops.pop()!;
        const b = output.pop() as number;
        const a = output.pop() as number;
        if (op === '+') { output.push(a + b); }
        else if (op === '-') { output.push(a - b); }
        else if (op === '*') { output.push(a * b); }
    }

    for (const tok of tokens) {
        if (tok === '(') {
            ops.push(tok);
        } else if (tok === ')') {
            while (ops.length && ops[ops.length - 1] !== '(') { applyOp(); }
            ops.pop();
        } else if (prec[tok] !== undefined) {
            while (ops.length && prec[ops[ops.length - 1]] >= prec[tok]) { applyOp(); }
            ops.push(tok);
        } else {
            const num = Number(tok);
            if (!isNaN(num)) {
                output.push(num);
            } else if (vars[tok] !== undefined) {
                output.push(vars[tok]);
            } else {
                output.push(0);
            }
        }
    }
    while (ops.length) { applyOp(); }
    return (output[0] as number) || 0;
}

export function extractImageInfo(
    fmt: CompiledFormat,
    variables: any[]
): ExtractedImageInfo | null {
    const m = fmt.descriptor.mapping;

    const rowsVar = findMember(variables, m.rows);
    const colsVar = findMember(variables, m.cols);
    const dataVar = findMember(variables, m.data);
    if (!rowsVar || !colsVar || !dataVar) { return null; }

    const rows = parseIntValue(rowsVar);
    const cols = parseIntValue(colsVar);
    if (rows <= 0 || cols <= 0) { return null; }

    const channels = resolveChannels(m.channels, variables);
    const cvDepth = resolveDepth(m.depth, variables);
    const dataPtr = parseAnyPointer(dataVar);
    const step = resolveStep(m.step, variables);

    if (step[0] <= 0) { return null; }

    const cvType = cvDepth + ((channels - 1) << 3);

    const exprVars: Record<string, number> = {
        rows, cols, channels, step: step[0], depth: cvDepth
    };

    const datastartMember = findMember(variables, 'datastart');
    const dataendMember = findMember(variables, 'dataend');
    let datastartPtr: Ptr;
    let dataendPtr: Ptr;

    if (datastartMember && dataendMember) {
        datastartPtr = parseAnyPointer(datastartMember);
        dataendPtr = parseAnyPointer(dataendMember);
        exprVars['datastart'] = datastartPtr.addr;
        exprVars['dataend'] = dataendPtr.addr;
    } else {
        datastartPtr = dataPtr;
        const memSize = evalSimpleExpr(fmt.descriptor.memorySize, exprVars);
        dataendPtr = {
            addr: dataPtr.addr + memSize,
            hex: '0x' + (dataPtr.addr + memSize).toString(16).padStart(16, '0')
        };
        exprVars['datastart'] = datastartPtr.addr;
        exprVars['dataend'] = dataendPtr.addr;
    }

    const memorySize = evalSimpleExpr(fmt.descriptor.memorySize, exprVars);
    if (memorySize <= 0) { return null; }

    const flagsMember = findMember(variables, 'flags');
    const flags = flagsMember ? parseIntValue(flagsMember) : cvType;

    return {
        rows, cols, channels, cvDepth,
        dataPtr, step, memorySize,
        flags, datastartPtr, dataendPtr
    };
}
