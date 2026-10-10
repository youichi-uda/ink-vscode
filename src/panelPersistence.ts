// The webview stores a serializable model, including Ink runtime and rewind snapshots.
export function attachPanelPersistence(owner: any) {
    const webview = owner.panel.webview, send = webview.postMessage.bind(webview), handle = owner.handleMessage.bind(owner);
    owner.inkSaved = null;
    owner.inkCapture = function () {
        if (owner.constructor.viewType === 'inkPreview' && owner.story && owner.previewView) {
            if (owner.inkCompiledStory !== owner.story) {
                owner.inkCompiled = owner.story.ToJson();
                owner.inkCompiledStory = owner.story;
            }
            owner.inkSaved = { version: 1, documentUri: owner.documentUri, compiled: owner.inkCompiled, state: owner.story.state.ToJson(), view: owner.previewView, history: owner.rewindHistory };
        }
        return owner.inkSaved;
    };
    webview.postMessage = function (message: any) {
        if (message.type === 'graph' || message.type === 'statistics')
            owner.inkSaved = { version: 1, message, readingSpeed: owner.readingSpeed };
        return send({ ...message, inkSnapshot: owner.inkCapture() });
    };
    owner.handleMessage = function (message: any) {
        if (message.type === 'inkReady') {
            const saved = owner.inkCapture();
            if (saved) {
                const data = saved.view ? { ...saved.view, replaceOutput: true, canRewind: owner.rewindHistory.length > 0 } : saved.message;
                return send({ ...data, inkSnapshot: saved, inkRestoreUi: true });
            }
            if (owner.inkRestoreError)
                return send({ type: 'error', message: owner.inkRestoreError });
            if (owner.constructor.viewType !== 'inkPreview')
                return owner.refresh();
            return;
        }
        return handle(message);
    };
}
export function restorePanelState(owner: any, state: any) {
    const saved = state?.inkSnapshot;
    if (!saved)
        return;
    try {
        if (saved.version !== 1)
            throw new Error('Unsupported saved panel version');
        if (owner.constructor.viewType === 'inkPreview') {
            const Story = (new (require("inkjs/compiler/Compiler").Compiler)('-> END').Compile()).constructor;
            owner.story = new Story(saved.compiled);
            owner.story.state.LoadJson(saved.state);
            owner.documentUri = saved.documentUri;
            owner.previewView = saved.view;
            owner.previewOutput = saved.view.output;
            owner.rewindHistory = saved.history || [];
            owner.inkCompiled = saved.compiled;
            owner.inkCompiledStory = owner.story;
        }
        owner.inkSaved = saved;
    }
    catch (error: any) {
        owner.inkRestoreError = 'Cannot restore Ink panel: ' + error.message;
    }
}
