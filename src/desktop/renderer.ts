import { createApp } from 'vue';
import './desktop.css';
import './overlay-window.css';
document.documentElement.classList.toggle('overlay-surface',['#overlay','#augment-overlay'].includes(location.hash));
const view=location.hash==='#shop-overlay-design'?await import('./ShopOverlayDesignPreview.vue'):
  location.hash==='#overlay-design'?await import('./OverlayDesignPreview.vue'):
  location.hash==='#augment-overlay'?await import('./AugmentOverlayApp.vue'):
  location.hash==='#overlay'?await import('./OverlayApp.vue'):await import('./DesktopApp.vue');
createApp(view.default).mount('#app');
