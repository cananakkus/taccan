// Wave 10.3 — Voice Hints (Web Speech API)
// Provides optional microphone input for spymaster hint word.
// Feature-detected; hidden if SpeechRecognition is unavailable.

import { ui } from './ui.js';
import { t } from './i18n.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let listening = false;
let micButton = null;

export function initVoiceHints() {
  if (!SpeechRecognition || !ui.hintWordInput) return;

  micButton = document.createElement('button');
  micButton.type = 'button';
  micButton.className = 'btn subtle small voice-btn';
  micButton.textContent = '\u{1F3A4}';
  micButton.title = t('voice_input_hint');
  micButton.setAttribute('aria-label', t('voice_input_hint'));

  ui.hintWordInput.parentElement.insertBefore(micButton, ui.hintWordInput.nextSibling);

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener('result', (event) => {
    const transcript = event.results[0]?.[0]?.transcript?.trim();
    if (transcript) {
      // Extract first word only (hints are single words)
      const firstWord = transcript.split(/\s+/)[0].replace(/[^a-zA-Z-]/g, '');
      if (firstWord) {
        ui.hintWordInput.value = firstWord;
        ui.hintWordInput.focus();
      }
    }
    stopListening();
  });

  recognition.addEventListener('error', () => {
    stopListening();
  });

  recognition.addEventListener('end', () => {
    stopListening();
  });

  micButton.addEventListener('click', () => {
    if (listening) {
      recognition.abort();
      stopListening();
    } else {
      startListening();
    }
  });
}

function startListening() {
  try {
    recognition.lang = document.documentElement.lang || 'en-US';
    recognition.start();
    listening = true;
    micButton.classList.add('active');
    micButton.setAttribute('aria-pressed', 'true');
  } catch (_) {
    // Already started or not available
  }
}

function stopListening() {
  listening = false;
  if (micButton) {
    micButton.classList.remove('active');
    micButton.setAttribute('aria-pressed', 'false');
  }
}
