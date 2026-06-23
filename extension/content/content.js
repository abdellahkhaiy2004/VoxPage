// Content Script - Smart Text Extraction with Reader Overlay
const MessageTypes = {
    EXTRACT_TEXT: 'EXTRACT_TEXT',
    TEXT_EXTRACTED: 'TEXT_EXTRACTED',
    SHOW_READER_OVERLAY: 'SHOW_READER_OVERLAY',
    HIDE_READER_OVERLAY: 'HIDE_READER_OVERLAY'
};

console.log('[Content] Script Loaded');

// Reader overlay element
let readerOverlay = null;

// Create and show the reader overlay on the page
function showReaderOverlay(readerName) {
    if (readerOverlay) {
        readerOverlay.remove();
    }

    readerOverlay = document.createElement('div');
    readerOverlay.id = 'ai-reader-overlay';
    readerOverlay.innerHTML = `
        <div class="reader-widget">
            <div class="reader-pulse"></div>
            <span class="reader-icon">🔊</span>
            <span class="reader-name">${readerName || 'Aiko'} is reading...</span>
            <button class="reader-stop-btn" id="stop-reading-btn">✕</button>
        </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.id = 'ai-reader-style';
    style.textContent = `
        #ai-reader-overlay {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            font-family: 'Segoe UI', system-ui, sans-serif;
        }
        
        .reader-widget {
            display: flex;
            align-items: center;
            gap: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 16px;
            border-radius: 30px;
            box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
            animation: slideIn 0.3s ease;
        }
        
        @keyframes slideIn {
            from { transform: translateX(100px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        .reader-pulse {
            width: 12px;
            height: 12px;
            background: #4caf50;
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.3); opacity: 0.7; }
        }
        
        .reader-icon {
            font-size: 18px;
            animation: bounce 0.6s ease infinite alternate;
        }
        
        @keyframes bounce {
            from { transform: translateY(0); }
            to { transform: translateY(-3px); }
        }
        
        .reader-name {
            font-size: 14px;
            font-weight: 600;
        }
        
        .reader-stop-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        
        .reader-stop-btn:hover {
            background: rgba(255,255,255,0.4);
            transform: scale(1.1);
        }
    `;

    // Remove old style if exists
    const oldStyle = document.getElementById('ai-reader-style');
    if (oldStyle) oldStyle.remove();

    document.head.appendChild(style);
    document.body.appendChild(readerOverlay);

    // Add stop button listener
    document.getElementById('stop-reading-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'STOP_AUDIO' });
        hideReaderOverlay();
    });
}

function hideReaderOverlay() {
    if (readerOverlay) {
        readerOverlay.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => {
            if (readerOverlay) {
                readerOverlay.remove();
                readerOverlay = null;
            }
        }, 300);
    }
}

// Extract only meaningful content from the page
function extractPageContent() {
    const content = [];

    // Get page title
    const title = document.title;
    if (title) {
        content.push(`Title: ${title}`);
    }

    // Get headings (h1-h3)
    const headings = document.querySelectorAll('h1, h2, h3');
    headings.forEach(h => {
        const text = h.innerText.trim();
        if (text && text.length > 2) {
            content.push(`[${h.tagName}]: ${text}`);
        }
    });

    // Get main content from article, main, or content sections
    const mainSelectors = ['article', 'main', '[role="main"]', '.content', '.post', '.article-body'];
    let mainContent = '';

    for (const selector of mainSelectors) {
        const el = document.querySelector(selector);
        if (el) {
            mainContent = el.innerText;
            break;
        }
    }

    // If no main content found, get paragraphs
    if (!mainContent) {
        const paragraphs = document.querySelectorAll('p');
        const paraTexts = [];
        paragraphs.forEach(p => {
            const text = p.innerText.trim();
            if (text && text.length > 50) {
                paraTexts.push(text);
            }
        });
        mainContent = paraTexts.join('\n\n');
    }

    if (mainContent) {
        content.push(`\nContent:\n${mainContent}`);
    }

    let result = content.join('\n');
    result = result.replace(/\n{3,}/g, '\n\n').trim();

    return result;
}

// Audio player in content script (persists when popup closes)
let contentAudio = null;

function playAudioInPage(base64Audio, readerName) {
    console.log('[Content] playAudioInPage called, audio length:', base64Audio?.length, 'reader:', readerName);

    // Stop any existing audio
    stopAudioInPage();

    // Show overlay
    showReaderOverlay(readerName);

    // Create and play audio
    const audioSrc = `data:audio/mpeg;base64,${base64Audio}`;
    contentAudio = new Audio(audioSrc);

    console.log('[Content] Audio element created, attempting to play...');

    contentAudio.onended = () => {
        console.log('[Content] Audio finished');
        hideReaderOverlay();
        chrome.runtime.sendMessage({ type: 'AUDIO_FINISHED' });
    };

    contentAudio.onerror = (e) => {
        console.error('[Content] Audio error:', e);
        hideReaderOverlay();
    };

    contentAudio.play().then(() => {
        console.log('[Content] Audio playing successfully!');
    }).catch(err => {
        console.error('[Content] Audio play failed:', err);
        hideReaderOverlay();
    });
}

function stopAudioInPage() {
    if (contentAudio) {
        contentAudio.pause();
        contentAudio = null;
    }
    hideReaderOverlay();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Content] Received:', message);

    if (message.type === MessageTypes.EXTRACT_TEXT) {
        const text = extractPageContent();
        console.log('[Content] Extracted text length:', text.length);
        sendResponse({ success: true, text: text });
    } else if (message.type === 'SHOW_READER_OVERLAY') {
        showReaderOverlay(message.readerName);
        sendResponse({ success: true });
    } else if (message.type === 'HIDE_READER_OVERLAY') {
        hideReaderOverlay();
        sendResponse({ success: true });
    } else if (message.type === 'PLAY_AUDIO_IN_PAGE') {
        // Play audio in page so it persists when popup closes
        playAudioInPage(message.audioBase64, message.readerName);
        sendResponse({ success: true });
    } else if (message.type === 'STOP_AUDIO') {
        stopAudioInPage();
        sendResponse({ success: true });
    }
    return true;
});
