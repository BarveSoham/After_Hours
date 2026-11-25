import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        mainscreen: resolve(__dirname, 'mainscreen/index.html'),
        game: resolve(__dirname, 'game.html'),
        howToPlay: resolve(__dirname, 'mainscreen/how-to-play.html'),
        settings: resolve(__dirname, 'mainscreen/settings.html'),
        quit: resolve(__dirname, 'mainscreen/quit.html')
      }
    }
  }
});
