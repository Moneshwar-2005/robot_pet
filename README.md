# Kuro — Smart Robot Pet & Personal Assistant

A modern, responsive web application shell and companion dashboard for **Kuro**, a personal productivity assistant and smart robot pet companion.

---

## 🚀 Project Roadmap

- **Phase 1: Web Application Shell & Dashboard** *(Current)*
  - Responsive desktop & mobile layout.
  - Simulated 2.4" TFT LCD head visor display (320x240) with animated digital eyes, speaking mouth, and 10 dynamic moods.
  - 10 Navigation pages: Dashboard, Pet Studio, Personal Assistant, Tasks & Projects, Reminders & Calendar, Work Tracking (Pomodoro), Daily Reports, AI & Memory, Integrations, and Settings & Privacy.
  - Dark and Light theme support.
  - Clean client-side state models for tasks, reminders, and context.
- **Phase 2: Database & Backend** *(Next)*
  - Supabase integration with Row Level Security (RLS).
  - User authentication and persistent cross-device synchronization.
  - Conversational AI backend and memory embeddings.
- **Phase 7: Physical Robot Hardware**
  - ESP32-S3 microcontroller integration with rear USB-C power.
  - Screen-only box-shaped desktop enclosure (no servos, no motors, no speakers).
  - Physical 2.4-inch TFT LCD (320x240 SPI) display synchronization via local Wi-Fi / WebSockets.

---

## 🛠️ Technology Stack

- **Framework:** React 19 (`react`, `react-dom`)
- **Language:** TypeScript
- **Bundler:** Vite
- **Styling:** Custom Vanilla CSS Design System (CSS Custom Properties)
- **Icons:** Lucide React (`lucide-react`)
- **Linter:** Oxlint

---

## 💻 Getting Started Locally

### Prerequisites
- Node.js (v20+ recommended)
- npm

### Installation & Development
```bash
# Clone the repository
git clone https://github.com/Moneshwar-2005/robot_pet.git
cd robot_pet

# Install dependencies
npm install

# Start development server
npm run dev
```

### Production Build & Linting
```bash
# Type-check and build production bundle
npm run build

# Run linter
npm run lint
```
