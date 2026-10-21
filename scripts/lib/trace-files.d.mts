import type {ReaderStatus} from '../../src/recognition/status';
export interface TraceFile {file:string;bytes:number;identity:string}
export function traceFiles(input:string):Promise<TraceFile[]>;
export function traceLines(files:TraceFile[]):AsyncGenerator<{file:string;line:number;text:string;error?:never}|{file:string;line:number;error:string;text?:never}>;
export function decisionRecord(entry:unknown):{capturedAt:string;clock:number;status:ReaderStatus}|null;
