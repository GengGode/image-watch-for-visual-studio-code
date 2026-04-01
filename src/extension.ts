import * as vscode from 'vscode';
import { ImageWatchWebviewViewProvider } from './image-watch-webview-view';
import { isCvMatStructure, parseCvMat, readMatMemory } from './mat-utils';
import { createTrackerFactory, addWatchedVariable, clearWatchedVariables } from './debug-tracker';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "image-watch-for-visual-studio-code" is now active!');

    context.subscriptions.push(vscode.commands.registerCommand('image-watch-for-visual-studio-code.hello', () => {
        vscode.window.showInformationMessage('Hello from 适用于 Visual Studio Code 的 Image Watch!');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('image-watch-for-visual-studio-code.open_image_watch_panel', () => {
        vscode.window.showInformationMessage('请在底部面板查看 Image Watch 视图');
        vscode.commands.executeCommand('image-watch.panel.focus');
    }));

    context.subscriptions.push(vscode.window.registerWebviewViewProvider(
        'image-watch.panel',
        new ImageWatchWebviewViewProvider(context),
        { webviewOptions: { retainContextWhenHidden: true } }
    ));

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory('*', createTrackerFactory())
    );

    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession(() => {
            clearWatchedVariables();
            ImageWatchWebviewViewProvider.onReady((view) => {
                view.webview.postMessage({ command: 'clear_all' });
            });
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand(
        'image-watch-for-visual-studio-code.add_to_watch_image',
        async (current_var) => {
            if (!current_var || !current_var.variable || !current_var.variable.variablesReference) {
                return vscode.window.showErrorMessage('当前变量无效或未定义');
            }

            const session = vscode.debug.activeDebugSession;
            if (!session) {
                return vscode.window.showErrorMessage('没有活动的调试会话');
            }

            let variables: any[];
            try {
                const resp = await session.customRequest('variables', {
                    variablesReference: current_var.variable.variablesReference
                });
                if (!resp?.variables) {
                    return vscode.window.showErrorMessage('未能从调试会话获取变量');
                }
                variables = resp.variables;
            } catch {
                return vscode.window.showErrorMessage('获取变量失败');
            }

            if (!isCvMatStructure(variables)) {
                return vscode.window.showErrorMessage('变量数据格式不正确, 可能不是 cv::Mat 类型');
            }

            const mat = parseCvMat(variables);
            const memory = await readMatMemory(session, mat);
            if (!memory) {
                return vscode.window.showErrorMessage('无法读取内存数据，请检查调试会话是否正常');
            }

            const varName = current_var.variable.name;
            addWatchedVariable(varName);

            vscode.commands.executeCommand('image-watch.panel.focus');

            ImageWatchWebviewViewProvider.onReady((view) => {
                view.webview.postMessage({
                    command: 'add_variable',
                    variable_name: varName,
                    memory: memory,
                    mat: mat,
                    from: 'watch'
                });
            });
        }
    ));
}

export function deactivate() { }
