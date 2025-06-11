// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "image-watch-for-visual-studio-code" is now active!');

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'image-watch.panel', // 必须与 package.json 里的 id 一致
			new ImageWatchWebviewViewProvider(context)
		)
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('image-watch-for-visual-studio-code.openImageWatch', () => {
			vscode.window.showInformationMessage('请在底部面板查看 Image Watch 视图');
		})
	);

	const disposable = vscode.commands.registerCommand('image-watch-for-visual-studio-code.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from 适用于 Visual Studio Code 的 Image Watch!');
	});
	context.subscriptions.push(disposable);
}


class ImageWatchWebviewViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly context: vscode.ExtensionContext) { }

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken
	) {
		webviewView.webview.options = {
			enableScripts: true
		};

		// 这里可以传递数据到 webview
		webviewView.webview.html = this.getHtmlForWebview(['图片1', '图片2']);

		// 监听 webview 消息
		webviewView.webview.onDidReceiveMessage(message => {
			if (message.command === 'refresh') {
				// 处理刷新等操作
			}
		});
	}

	getHtmlForWebview(images: string[]): string {
		return `<!-- 可直接用于 getHtmlForWebview 返回值 -->
<!DOCTYPE html>
<html lang="zh-cn">
<head>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      background: #222;
      color: #ccc;
    }
    .toolbar {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      background: #181818;
      border-bottom: 1px solid #333;
    }
    .toggle-btn {
      appearance: none;
      outline: none;
      border: 1px solid #444;
      background: #222;
      color: #ccc;
      padding: 4px 16px;
      margin-right: 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s, border 0.2s;
    }
    .toggle-btn.selected {
      background: #007acc;
      color: #fff;
      border-color: #007acc;
    }
    .container {
      display: flex;
      height: calc(100vh - 40px);
    }
    .sidebar {
      width: 220px;
      background: #1e1e1e;
      border-right: 1px solid #333;
      overflow-y: auto;
      padding: 8px 0;
    }
    .thumb {
      display: flex;
      align-items: center;
      padding: 8px;
      cursor: pointer;
      border-bottom: 1px solid #333;
      transition: background 0.2s;
    }
    .thumb.selected {
      background: #333;
    }
    .thumb img {
      width: 48px;
      height: 48px;
      object-fit: contain;
      background: #444;
      margin-right: 10px;
      border-radius: 4px;
    }
    .thumb .info {
      flex: 1;
    }
    .main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #2d2d2d;
    }
    .main img {
      max-width: 90%;
      max-height: 90%;
      border-radius: 6px;
      background: #444;
      box-shadow: 0 0 8px #111;
    }
    .placeholder {
      color: #888;
      font-size: 1.2em;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar" id="thumbList">
		<div class="toolbar">
			<button id="btnLocal" class="toggle-btn selected">局部变量</button>
			<button id="btnWatch" class="toggle-btn">监视</button>
		</div>
		<div class="sidebar" id="varList">
			<!-- 这里可以动态生成局部变量或监视列表 -->
		</div>
    </div>
    <div class="main" id="mainView">
		<div class="main" id="currentImage">
			<!-- 这里显示当前选中的图片 -->
			<div class="placeholder">[无选择]</div>
		</div>
    </div>
  </div>
  <script>
    // 互斥按钮逻辑
    const btnLocal = document.getElementById('btnLocal');
    const btnWatch = document.getElementById('btnWatch');
    btnLocal.onclick = () => {
      btnLocal.classList.add('selected');
      btnWatch.classList.remove('selected');
      // TODO: 切换到局部变量数据
    };
    btnWatch.onclick = () => {
      btnWatch.classList.add('selected');
      btnLocal.classList.remove('selected');
      // TODO: 切换到监视数据
    };

    // 示例图片数据
    const images = [
      { name: "图片1", src: "https://via.placeholder.com/120x80?text=1", desc: "cv::Mat" },
      { name: "图片2", src: "https://via.placeholder.com/120x80?text=2", desc: "cv::Mat" },
      { name: "图片3", src: "https://via.placeholder.com/120x80?text=3", desc: "cv::Mat" }
    ];

    const varList = document.getElementById('varList');
    const currentImage = document.getElementById('currentImage');

    function renderThumbs() {
      varList.innerHTML = '';
      images.forEach((img, idx) => {
        const div = document.createElement('div');
        div.className = 'thumb';
        div.innerHTML = \`
			<img src = "\${img.src}" alt = "\${img.name}">
				<div class="info" >
					<div>\${ img.name } </div>
						<div style = "font-size:12px;color:#888;"> \${ img.desc } </div>
							</div>
								\`;
        div.onclick = () => selectImage(idx);
        varList.appendChild(div);
      });
    }

let scale = 1;
let translateX = 0;
let translateY = 0;
let isDragging = false;
let startX = 0;
let startY = 0;

function updateTransform() {
  const img = document.getElementById('mainImg');
  if (img) {
    img.style.transform = \`scale(\${ scale }) translate(\${ translateX }px, \${ translateY }px)\`;
  }
}

currentImage.addEventListener('wheel', (e) => {
  e.preventDefault();
  // 缩放
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  scale = Math.max(0.1, scale + delta);
  updateTransform();
}, { passive: false });

currentImage.addEventListener('mousedown', (e) => {
  const img = document.getElementById('mainImg');
  if (!img) return;
  isDragging = true;
  startX = e.clientX - translateX;
  startY = e.clientY - translateY;
  img.style.cursor = 'grabbing';
});

currentImage.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  translateX = e.clientX - startX;
  translateY = e.clientY - startY;
  updateTransform();
});

currentImage.addEventListener('mouseup', () => {
  isDragging = false;
  const img = document.getElementById('mainImg');
  if (img) img.style.cursor = 'grab';
});

currentImage.addEventListener('mouseleave', () => {
  isDragging = false;
  const img = document.getElementById('mainImg');
  if (img) img.style.cursor = 'grab';
});



function selectImage(idx) {
  Array.from(varList.children).forEach(el => el.classList.remove('selected'));
  varList.children[idx].classList.add('selected');
  scale = 1;
  translateX = 0;
  translateY = 0;
  currentImage.innerHTML = \`<img id = "mainImg" src = "\${images[idx].src}" alt = "\${images[idx].name}" style = "cursor: grab; transition: transform 0.1s;" />\`;
  updateTransform();
}
    renderThumbs();
  </script>
</body>
</html>`;

	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
