import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './scene/bvh';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 不存在');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
