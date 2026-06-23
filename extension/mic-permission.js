// Requests microphone permission for the extension origin. Once granted here,
// the popup's speech recognition works (same chrome-extension:// origin).
const status = document.getElementById('status');
const retry = document.getElementById('retry');

async function requestMic() {
    status.className = '';
    status.textContent = 'Requesting microphone permission…';
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // We only needed the permission — release the mic immediately.
        stream.getTracks().forEach(t => t.stop());
        status.className = 'ok';
        status.textContent = '✓ Microphone enabled. You can close this tab and use the mic in the extension.';
    } catch (err) {
        status.className = 'err';
        status.textContent = 'Microphone blocked (' + err.name + '). Click the mic icon in the address bar to allow it, then press "Request again".';
    }
}

retry.addEventListener('click', requestMic);
requestMic();
