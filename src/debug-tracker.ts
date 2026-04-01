import * as vscode from 'vscode';
import { ImageWatchWebviewViewProvider } from './image-watch-webview-view';
import { findCvMatsInScope, MatVariable, tryExpandAsCvMat, readMatMemory } from './mat-utils';

let watchedVariableNames: Set<string> = new Set();

export function addWatchedVariable(name: string) {
    watchedVariableNames.add(name);
}

export function clearWatchedVariables() {
    watchedVariableNames.clear();
}

export function getWatchedVariableNames(): ReadonlySet<string> {
    return watchedVariableNames;
}

class ImageWatchTracker implements vscode.DebugAdapterTracker {
    private session: vscode.DebugSession;
    private disposed = false;

    constructor(session: vscode.DebugSession) {
        this.session = session;
    }

    onDidSendMessage(message: any): void {
        if (message.type === 'event' && message.event === 'stopped') {
            this.handleStopped(message.body).catch(err => {
                console.error('[ImageWatch] Error handling stopped event:', err);
            });
        }
    }

    onWillStopSession(): void {
        this.disposed = true;
        sendClearAll();
        clearWatchedVariables();
    }

    private async handleStopped(body: any): Promise<void> {
        const threadId = body?.threadId;
        if (threadId === undefined) { return; }

        let frameId: number;
        try {
            const stResp = await this.session.customRequest('stackTrace', {
                threadId,
                startFrame: 0,
                levels: 1
            });
            if (!stResp?.stackFrames?.length) { return; }
            frameId = stResp.stackFrames[0].id;
        } catch { return; }

        if (this.disposed) { return; }

        let localsRef: number | undefined;
        try {
            const scResp = await this.session.customRequest('scopes', { frameId });
            if (!scResp?.scopes) { return; }
            const localsScope = scResp.scopes.find(
                (s: any) => s.name === 'Locals' || s.name === 'Local'
            );
            if (!localsScope) { return; }
            localsRef = localsScope.variablesReference;
        } catch { return; }

        if (this.disposed || !localsRef) { return; }

        let allLocalMats: MatVariable[];
        try {
            allLocalMats = await findCvMatsInScope(this.session, localsRef);
        } catch { return; }

        if (this.disposed) { return; }

        sendSetLocalVariables(allLocalMats);

        if (watchedVariableNames.size > 0) {
            const watchUpdates = allLocalMats.filter(m => watchedVariableNames.has(m.name));
            for (const item of watchUpdates) {
                sendUpdateVariable(item);
            }
        }
    }
}

function sendSetLocalVariables(mats: MatVariable[]) {
    const items = mats.map(m => ({
        variable_name: m.name,
        memory: m.memory,
        mat: m.mat,
        from: 'local'
    }));

    ImageWatchWebviewViewProvider.onReady((view) => {
        view.webview.postMessage({
            command: 'set_local_variables',
            variables: items
        });
    });
}

function sendUpdateVariable(m: MatVariable) {
    ImageWatchWebviewViewProvider.onReady((view) => {
        view.webview.postMessage({
            command: 'update_variable',
            variable_name: m.name,
            memory: m.memory,
            mat: m.mat
        });
    });
}

function sendClearAll() {
    ImageWatchWebviewViewProvider.onReady((view) => {
        view.webview.postMessage({ command: 'clear_all' });
    });
}

export function createTrackerFactory(): vscode.DebugAdapterTrackerFactory {
    return {
        createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
            return new ImageWatchTracker(session);
        }
    };
}
