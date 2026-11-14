<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { withBase } from 'vitepress';
import boardsPreview from '../../../app/src/assets/home/boards.webp';
import docsPreview from '../../../app/src/assets/home/docs.webp';
import projectPreview from '../../../app/src/assets/home/project.webp';
import sheetsPreview from '../../../app/src/assets/home/sheets.webp';
import slidesPreview from '../../../app/src/assets/home/slides.webp';
import present from '../../../app/src/assets/home/present.webp';
import review from '../../../app/src/assets/home/review.webp';
import sketch from '../../../app/src/assets/home/sketch.webp';
import welcome from '../../../app/src/assets/home/welcome.webp';

const scenes = [
  {
    id: 'workshop',
    label: 'Workshop',
    title: 'Keep the project together',
    description: 'Open the launch board, brief, budget, and review deck from one Team Project.',
    guide: '/guide/getting-started.html#workshop',
    pose: welcome,
    screenshot: projectPreview,
    alt: 'Shiori Workshop with four files in Studio North’s Product Launch project',
  },
  {
    id: 'boards',
    label: 'Boards',
    title: 'Sketch the launch plan',
    description: 'Group ideas and next steps on a board the whole team can edit.',
    guide: '/guide/collaboration.html',
    pose: sketch,
    screenshot: boardsPreview,
    alt: 'Launch Canvas with sticky notes for discovery, preparation, and launch',
  },
  {
    id: 'docs',
    label: 'Docs',
    title: 'Write the brief together',
    description: 'Draft the launch brief in a shared document and use the outline to find each section.',
    guide: '/guide/getting-started.html#docs',
    pose: review,
    screenshot: docsPreview,
    alt: 'Project Brief open in Shiori Docs with a section outline',
  },
  {
    id: 'sheets',
    label: 'Sheets',
    title: 'Track the launch budget',
    description: 'Compare planned and actual costs and use formulas to calculate what remains.',
    guide: '/guide/getting-started.html#sheets',
    pose: review,
    screenshot: sheetsPreview,
    alt: 'Launch Budget in Shiori Sheets with the formula for the remaining total selected',
  },
  {
    id: 'slides',
    label: 'Slides',
    title: 'Present the launch review',
    description: 'Build a review deck for the team and present it from the same project.',
    guide: '/guide/getting-started.html#slides',
    pose: present,
    screenshot: slidesPreview,
    alt: 'Review Deck in Shiori Slides showing the first of three slides',
  },
] as const;

const current = ref(0);
const playing = ref(false);
const showcase = ref<HTMLElement>();
const tourButton = ref<HTMLButtonElement>();
let timer: number | undefined;
let stopWatching: (() => void) | undefined;

function pauseTour() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  playing.value = false;
}

function toggleTour() {
  if (playing.value) {
    pauseTour();
    return;
  }

  playing.value = true;
  timer = window.setInterval(() => {
    current.value = (current.value + 1) % scenes.length;
  }, 6500);
}

function selectScene(index: number) {
  pauseTour();
  current.value = index;
}

function moveTab(event: KeyboardEvent, index: number) {
  let next: number;
  switch (event.key) {
    case 'ArrowRight': next = (index + 1) % scenes.length; break;
    case 'ArrowLeft': next = (index + scenes.length - 1) % scenes.length; break;
    case 'Home': next = 0; break;
    case 'End': next = scenes.length - 1; break;
    default: return;
  }
  event.preventDefault();
  selectScene(next);
  document.getElementById('showcase-tab-' + scenes[next].id)?.focus();
}

function pauseOnFocus(event: FocusEvent) {
  if (event.target !== tourButton.value) pauseTour();
}

function pauseOnHover(event: PointerEvent) {
  if (event.pointerType === 'mouse') pauseTour();
}

onMounted(() => {
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  function pauseForMotion() {
    if (motionPreference.matches) pauseTour();
  }
  function pauseInBackground() {
    if (document.hidden) pauseTour();
  }
  const visibility = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) pauseTour();
  });
  if (showcase.value) visibility.observe(showcase.value);
  motionPreference.addEventListener('change', pauseForMotion);
  document.addEventListener('visibilitychange', pauseInBackground);
  stopWatching = () => {
    visibility.disconnect();
    motionPreference.removeEventListener('change', pauseForMotion);
    document.removeEventListener('visibilitychange', pauseInBackground);
  };
});
onBeforeUnmount(() => {
  pauseTour();
  stopWatching?.();
});
</script>

<template>
  <div class="home-intro">
    <div class="hero-copy">
      <h1><span>Shiori</span>A self&#8209;hosted team workspace</h1>
      <p>Bring boards, docs, sheets, and slides together in one project.</p>
      <div class="hero-actions">
        <a class="primary" :href="withBase('/guide/getting-started.html')">Get Started</a>
        <a href="https://github.com/xiaotwu/Shiori/releases/latest">Download</a>
      </div>
    </div>

    <section
      id="showcase"
      ref="showcase"
      class="showcase"
      aria-label="Explore the workspace"
      aria-roledescription="carousel"
      @focusin="pauseOnFocus"
      @pointerenter="pauseOnHover"
    >
      <div class="showcase-controls">
        <button ref="tourButton" class="tour-toggle" type="button" @click="toggleTour">
          <span aria-hidden="true">{{ playing ? 'Ⅱ' : '▷' }}</span>
          {{ playing ? 'Pause tour' : 'Play tour' }}
        </button>
        <div class="showcase-tabs" role="tablist" aria-label="Product areas">
          <button
            v-for="(scene, index) in scenes"
            :id="'showcase-tab-' + scene.id"
            :key="scene.id"
            type="button"
            role="tab"
            :aria-controls="'showcase-panel-' + scene.id"
            :aria-selected="current === index"
            :tabindex="current === index ? 0 : -1"
            @click="selectScene(index)"
            @keydown="moveTab($event, index)"
          >
            {{ scene.label }}
          </button>
        </div>
      </div>

      <div
        v-for="(scene, index) in scenes"
        :id="'showcase-panel-' + scene.id"
        :key="scene.id"
        class="showcase-panel"
        role="tabpanel"
        :aria-labelledby="'showcase-tab-' + scene.id"
        :hidden="current !== index"
        tabindex="0"
      >
        <template v-if="current === index">
          <div class="scene-media">
            <div class="scene-pose" aria-hidden="true">
              <img :src="scene.pose" alt="" width="300" height="375" decoding="async">
            </div>
            <a
              class="scene-preview"
              :href="scene.screenshot"
              target="_blank"
              rel="noopener"
              :aria-label="'Open full-size screenshot: ' + scene.alt + ' (new tab)'"
            >
              <img
                :src="scene.screenshot"
                :alt="scene.alt"
                width="1280"
                height="720"
                decoding="async"
                :fetchpriority="index === 0 ? 'high' : 'auto'"
              >
            </a>
          </div>
          <div class="scene-caption">
            <div>
              <h2>{{ scene.title }}</h2>
              <p>{{ scene.description }}</p>
            </div>
            <a :href="withBase(scene.guide)">{{ scene.label }} guide <span aria-hidden="true">→</span></a>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-intro {
  box-sizing: border-box;
  display: grid;
  align-items: center;
  gap: clamp(24px, 3vw, 48px);
  max-width: 1280px;
  margin: 0 auto;
  padding: clamp(30px, 5vw, 78px) 24px clamp(32px, 5vw, 76px);
}

@media (min-width: 640px) { .home-intro { padding-inline: 48px; } }
@media (min-width: 960px) {
  .home-intro {
    grid-template-columns: minmax(0, 0.43fr) minmax(0, 1fr);
    padding-inline: 64px;
  }
}

.hero-copy h1 {
  max-width: 16ch;
  margin: 0;
  color: var(--vp-c-text-1);
  font-size: clamp(34px, 4vw, 55px);
  font-weight: 730;
  letter-spacing: -0.045em;
  line-height: 1.07;
  text-wrap: balance;
}
.hero-copy h1 span {
  display: block;
  margin-bottom: 12px;
  color: var(--vp-c-brand-1);
  font-size: 0.61em;
}
.hero-copy p {
  max-width: 31ch;
  margin: 18px 0 0;
  color: var(--vp-c-text-2);
  font-size: clamp(16px, 1.8vw, 21px);
  line-height: 1.55;
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 24px;
}

.hero-actions a,
.tour-toggle {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0 15px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 640;
  white-space: nowrap;
}

.hero-actions a:hover,
.tour-toggle:hover { background: var(--vp-c-brand-soft); }
.hero-actions .primary {
  border-color: var(--vp-c-brand-3);
  background: var(--vp-c-brand-3);
  color: var(--vp-button-brand-text);
}
.hero-actions .primary:hover { background: var(--vp-c-brand-2); }

.showcase {
  min-width: 0;
  scroll-margin-top: calc(var(--vp-nav-height) + 20px);
}
.showcase-controls {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.tour-toggle {
  order: 1;
  min-width: 100px;
  gap: 6px;
  margin-bottom: 5px;
  padding-inline: 10px;
  font-size: 12px;
}
.tour-toggle span { color: var(--vp-c-brand-1); font-size: 16px; }

.showcase-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px clamp(2px, 1vw, 16px);
}
.showcase-tabs button {
  min-height: 44px;
  margin-bottom: -1px;
  padding: 0 clamp(6px, 1.05vw, 12px);
  border-bottom: 2px solid transparent;
  color: var(--vp-c-text-2);
  font-size: clamp(12px, 1.4vw, 16px);
  font-weight: 640;
}
.showcase-tabs button:hover,
.showcase-tabs button[aria-selected='true'] { color: var(--vp-c-brand-1); }
.showcase-tabs button[aria-selected='true'] { border-bottom-color: var(--vp-c-brand-1); }

.home-intro :is(a, button, [tabindex]):focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}

.scene-media {
  display: grid;
  grid-template-columns: minmax(0, 0.26fr) minmax(0, 1fr);
  align-items: end;
  gap: clamp(10px, 1.6vw, 22px);
  padding: clamp(9px, 1.65vw, 22px);
  border: 1px solid var(--vp-c-divider);
  border-radius: 22px;
  background: var(--vp-c-bg-soft);
}
.scene-pose {
  position: relative;
  isolation: isolate;
  aspect-ratio: 4 / 5;
}
.scene-pose::before {
  position: absolute;
  z-index: -1;
  inset: 17% 4% 2%;
  border-radius: 50%;
  background: var(--vp-c-brand-soft);
  content: '';
}
.scene-pose img { display: block; width: 100%; height: auto; }

.scene-preview {
  display: block;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: #f8f6f9;
  box-shadow: 0 12px 32px rgb(32 21 35 / 12%);
}
.scene-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }

.scene-caption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 3px 18px;
  padding: 15px 3px 0;
}
.scene-caption > div { flex: 1 1 330px; }
.scene-caption h2 {
  margin: 0;
  color: var(--vp-c-text-1);
  font-size: clamp(19px, 1.85vw, 25px);
  font-weight: 680;
  letter-spacing: -0.027em;
  line-height: 1.22;
}
.scene-caption p {
  margin: 5px 0 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.55;
}
.scene-caption a {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-brand-1);
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}
.scene-caption a:hover { text-decoration: underline; text-underline-offset: 3px; }

@media (max-width: 639px) {
  .showcase-controls { flex-wrap: wrap; gap: 0; }
  .showcase-tabs { flex: 0 0 100%; justify-content: space-between; }
  .tour-toggle { order: 0; margin-left: auto; }
  .scene-media { border-radius: 15px; }
  .scene-preview { border-radius: 8px; }
}

@media (prefers-reduced-motion: no-preference) {
  .scene-preview { animation: reveal-preview 220ms ease-out; }
  .scene-pose img { animation: reveal-pose 350ms ease-out; }
}
@media (prefers-reduced-motion: reduce) { .tour-toggle { display: none; } }

@keyframes reveal-preview { from { opacity: 0.65; } }
@keyframes reveal-pose { from { opacity: 0.6; transform: translateY(7px); } }
</style>
