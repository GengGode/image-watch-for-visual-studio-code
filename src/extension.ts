import * as vscode from 'vscode';
import { ImageWatchWebviewViewProvider } from './image-watch-webview-view';
import { debug } from 'console';

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "image-watch-for-visual-studio-code" is now active!');

  // hello 命令
  context.subscriptions.push(vscode.commands.registerCommand('image-watch-for-visual-studio-code.hello', () => {
    vscode.window.showInformationMessage('Hello from 适用于 Visual Studio Code 的 Image Watch!');
  }));
  // 激活 Image Watch 面板
  context.subscriptions.push(vscode.commands.registerCommand('image-watch-for-visual-studio-code.open_image_watch_panel', () => {
    vscode.window.showInformationMessage('请在底部面板查看 Image Watch 视图');
    vscode.commands.executeCommand('image-watch.panel.focus');
  }));

  if (!ImageWatchWebviewViewProvider.global_view) {
    // 如果全局视图未定义，创建一个新的
    new ImageWatchWebviewViewProvider(context);
  }

  // 注册 Image Watch 面板
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(
    'image-watch.panel', // 必须与 package.json 里的 id 一致
    new ImageWatchWebviewViewProvider(context),
    { webviewOptions: { retainContextWhenHidden: true } }// 保持上下文，当面板隐藏时
  ));

  // 注册变量右键菜单
  context.subscriptions.push(vscode.commands.registerCommand('image-watch-for-visual-studio-code.add_to_watch_image', async (current_var) => {
    if (current_var.container.name != 'Locals')
      return vscode.window.showErrorMessage('只能添加局部变量到 Image Watch 面板');
    if (!current_var || !current_var.variable || !current_var.variable.variablesReference)
      return vscode.window.showErrorMessage('当前变量无效或未定义');

    const session = vscode.debug.activeDebugSession;
    if (!session)
      return vscode.window.showErrorMessage('没有活动的调试会话');

    // https://microsoft.github.io/debug-adapter-protocol/specification
    const var_request = await session.customRequest('variables', { variablesReference: current_var.variable.variablesReference });
    if (var_request == undefined)
      return vscode.window.showErrorMessage('未能从调试会话获取变量');
    // cppvsdbg
    const variables = var_request.variables;
    if (!Array.isArray(variables))
      return vscode.window.showErrorMessage('获取到的变量数据格式不正确');
    if (variables.length == 0)
      return vscode.window.showErrorMessage('变量数据成员为空');
    if (variables.length != 12)
      return vscode.window.showErrorMessage('变量数据成员数量不正确, 可能不是cv::Mat类型');
    // 检查变量是否为 cv::Mat 类型
    if (variables[0].name != 'flags' || variables[1].name != 'dims' || variables[2].name != 'rows' ||
      variables[3].name != 'cols' || variables[4].name != 'data' || variables[5].name != 'datastart' ||
      variables[6].name != 'dataend' || variables[7].name != 'datalimit' || variables[8].name != 'allocator' ||
      variables[9].name != 'u' || variables[10].name != 'size' || variables[11].name != 'step') {
      return vscode.window.showErrorMessage('变量数据格式不正确, 可能不是 cv::Mat 类型');
    }
    function parse_int_key(variable: any): number {
      if (variable.type != 'int') {
        vscode.window.showErrorMessage(`变量 ${variable.name} 的类型不是 int`);
        return 0;
      }
      return parseInt(variable.value);
    }
    class ptr { addr!: number; hex!: String; };
    function parse_ptr_key(variable: any): ptr {
      if (variable.type != 'unsigned char *' && variable.type != 'const unsigned char *') {
        vscode.window.showErrorMessage(`变量 ${variable.name} 的类型不是 unsigned char * 或 const unsigned char *`);
        return { addr: 0, hex: '0x0000000000000000' };
      }
      // 直接取固定长度的十六进制地址 将十六进制地址转换为十进制整数
      const hex_value = variable.value.substr(0, 18); // 去掉前缀 '0x'
      const decimal_value = parseInt(hex_value);
      return { addr: decimal_value, hex: hex_value };
    }


    const mat = {
      flags: parse_int_key(variables[0]),
      dims: parse_int_key(variables[1]),
      rows: parse_int_key(variables[2]),
      cols: parse_int_key(variables[3]),
      data: parse_ptr_key(variables[4]),
      datastart: parse_ptr_key(variables[5]),
      dataend: parse_ptr_key(variables[6]),
      datalimit: parse_ptr_key(variables[7]),

      // allocator: variables[8].value,
      // u:         variables[9].value,
      // size:      variables[10].value,
      // step:      variables[11].value
    };

    console.log(`当前变量: ${current_var.variable.name}, 变量列表:`, variables);

    vscode.commands.executeCommand('image-watch.panel.focus');

    // 获取内存数据转为Uint8Array
    // https://microsoft.github.io/debug-adapter-protocol/specification
    /*interface ReadMemoryResponse extends Response {
        body?: {
          address: string;
          unreadableBytes ?: number;
          data ?: string;
        };
      }
    */
    const memory_data = await session.customRequest('readMemory', { memoryReference: mat.datastart.hex, offset: 0, count: mat.dataend.addr - mat.datastart.addr });
    if (!memory_data || !memory_data.data) {
      return vscode.window.showErrorMessage('无法读取内存数据，请检查调试会话是否正常');
    }
    // 将 base64 编码的内存数据转换为 Uint8Array
    const memory = Uint8Array.from(Buffer.from(memory_data.data, 'base64'));

    ImageWatchWebviewViewProvider.onReady(async (view) => {
      // 发送消息到 webview，通知它添加变量
      view.webview.postMessage({
        command: 'add_variable',
        variable_name: current_var.variable.name,
        memory: memory,
        mat: mat
      });
    });

  }));
}

// This method is called when your extension is deactivated
export function deactivate() { }
