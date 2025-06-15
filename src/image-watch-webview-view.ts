
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ImageWatchWebviewViewProvider implements vscode.WebviewViewProvider {
    public static global_view: vscode.WebviewView | undefined;
    public static onReadyCallbacks: Array<(view: vscode.WebviewView) => void> = [];
    static async onReady(callback: (view: vscode.WebviewView) => void) {
        if (ImageWatchWebviewViewProvider.global_view) {
            // 如果全局视图已经存在，直接执行回调
            callback(ImageWatchWebviewViewProvider.global_view);
        } else {
            // 否则将回调添加到列表中，等待视图准备好时执行
            ImageWatchWebviewViewProvider.onReadyCallbacks.push(callback);
        }
    }

    constructor(private readonly context: vscode.ExtensionContext) { }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ) {
        webviewView.webview.options = { enableScripts: true }; // 允许脚本执行

        // 这里可以传递数据到 webview
        webviewView.webview.html = this.getHtmlForWebviewFromFile(webviewView.webview);
        // 监听 webview 消息
        webviewView.webview.onDidReceiveMessage(message => {
            if (message.command === 'refresh') {
                // 处理刷新等操作
            } else if (message.command === 'hide_variables') {
                // 隐藏变量操作
            }
        });

        // 保存全局引用
        ImageWatchWebviewViewProvider.global_view = webviewView;
        // 执行所有准备好的回调
        ImageWatchWebviewViewProvider.onReadyCallbacks.forEach(callback => callback(webviewView));
        ImageWatchWebviewViewProvider.onReadyCallbacks = []; // 清空回调列表
    }
    getHtmlForWebviewFromFile(webview: vscode.Webview) {
        try {
            // return fs.readFileSync(vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'image-watch-panel.html')).with({ scheme: 'vscode-resource' }).toString(), 'utf-8');
            let html = fs.readFileSync(path.join(this.context.extensionPath, 'resources', 'image-watch-panel.html'), 'utf-8');
            const opencvUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'opencv.js'));
            html = html.replace('<!-- opencv.js -->', opencvUri.toString());
            const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'image-watch.css'));
            html = html.replace('<!-- image-watch.css -->', cssUri.toString());
            return html;
        } catch (err) {
            return `<html><body><h2>无法加载 image-watch-panel.html</h2><pre>${err}</pre></body></html>`;
        }
    }
}