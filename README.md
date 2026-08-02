<div align="center">

# 👁️ VisionLingo

### See it. Say it. Learn it.

**An AI-powered, real-time object recognition and multilingual language-learning application that runs entirely in the browser**

[Live Demo](https://visionlingo.vercel.app/) ·  [Tech Stack](#tech-stack)

</div>


## Overview

VisionLingo turns any camera — into a live language tutor. Point it at an everyday object and the app detects it, names it,
translates it into different languages, and speaks it aloud — all in
real time, entirely inside the browser.

Under the hood, it runs two pre-trained deep learning models client-side
via **TensorFlow.js** : a real-time object detector for live bounding-box
tracking, and a 1,000-class image classifier for precise, on-demand
identification. This two-stage design gives VisionLingo a substantially
broader working vocabulary than typical single-model browser detection
demos, while keeping the live camera feed fast and responsive.


## Key Features

- 🎥 **Real-time object detection** with live bounding boxes, back or front camera
- 🏷️ **Instant labeling** — tap any detected object, or anywhere on screen, to identify it
- 🌍 **13 languages** — English, Spanish, French, German, Italian, Portuguese, Japanese, Korean, Chinese, Hindi, Arabic, Russian, Dutch
- 🔊 **Native pronunciation** via the browser's speech engine, on tap or fully automatic
- 📌 **Pin labels** to the camera view as persistent on-screen tags
- 💾 **Personal vocabulary collection** — save, search, filter by language, and sort saved words
- 🎴 **Flip-card review mode** for saved vocabulary
- 🎓 **Guided onboarding** and an always-available instructions panel
- 🛡️ **Resilient by design** — graceful handling of camera permission issues, blocked CDNs, and GPU/WebGL failures, each with a clear on-screen explanation rather than a silent dead end

---

## Tech Stack

| Layer | Technology |
|---|---|
| Object detection | **COCO-SSD** (TensorFlow.js) — pre-trained SSD + MobileNetV2 backbone, 80 classes |
| Object classification | **MobileNetV2** (TensorFlow.js) — pre-trained on ImageNet, 1,000 classes |
| ML runtime | **TensorFlow.js**  |
| Translation | **MyMemory Translation API** |
| Text-to-speech | **Web Speech API** (`speechSynthesis`) |
| Camera | **MediaDevices / getUserMedia** |
| Persistence | **localStorage** (saved words, settings, translation cache) |
| Frontend | **HTML5, CSS3, JavaScript** |

## How It Works

```
 Camera frame
      │
      ▼
┌─────────────────┐   runs continuously (~5x/second)
│    COCO-SSD      │ → live bounding boxes, 80 broad categories
└─────────────────┘
      │  tap a box, or anywhere on screen
      ▼
┌─────────────────┐   runs on demand, on the tapped region
│   MobileNetV2    │ → precise label, 1,000 ImageNet classes
└─────────────────┘
      │
      ▼
 Translation API → translated word → Speech synthesis → spoken aloud
```

**Why two models instead of one?** COCO-SSD is fast and returns real
bounding-box coordinates, essential for tracking objects live as the
camera moves — but it only recognizes 80 categories. MobileNetV2 knows
1,000 ImageNet categories, a far richer vocabulary, but is a pure
classifier with no location awareness and no place in a continuous
per-frame loop. Running COCO-SSD continuously for boxes, and MobileNetV2
on demand for the specific word, combines real-time visual feedback with
a vocabulary that isn't artificially capped at 80 words.

An **Auto-speak** mode also runs MobileNetV2 periodically on the most
prominent tracked object, translating and pronouncing it automatically —
no tap required.


## Project Structure

```
visionlingo/
├── index.html          Marketing landing page
├── app.html              The application — camera, detection, translation,
│                        saved words, and settings screens
├── style.css             Styling for app.html
├── languages.js           Language definitions: display name, flag,
│                        translation code, speech locale
├── app.js                 Core application logic — camera lifecycle, model
│                        loading, the detection/classification pipeline,
│                        translation, speech, saved-word management
└── camera-test.html      Standalone camera/permissions diagnostic
```


## Getting Started

Camera access requires a secure context (`https://` or `localhost`).

```bash
# Clone the repo
git clone https://github.com/your-username/visionlingo.git
cd visionlingo

# Serve it locally — any static server works
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080` for the landing page, or
`http://localhost:8080/app.html` to go straight to the scanner. Allow
camera access when prompted, wait for the model to finish loading, then
point your camera at an object and tap it.


## License

Provided as-is for personal and educational use. TensorFlow.js models are
distributed by Google under the Apache 2.0 License; the MyMemory API is
free for reasonable personal/non-commercial use per its own terms.
