import { defineConfig } from 'vite';
<<<<<<< HEAD
=======
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
>>>>>>> 70a8a884783de578fca7e45f1224c476230ab5cb

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
<<<<<<< HEAD
  }
});
=======
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        howToPlay: resolve(__dirname, 'how_to_play.html'),
        settings: resolve(__dirname, 'settings.html'),
        quit: resolve(__dirname, 'quit_screen.html'),
        game: resolve(__dirname, 'game.html')
      }
    }
  }
});
>>>>>>> 70a8a884783de578fca7e45f1224c476230ab5cb
