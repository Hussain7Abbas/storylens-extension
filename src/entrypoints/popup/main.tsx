import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './style.css';
import { BrowserRouter } from 'react-router';
import { setupApiClient } from '@/utils/setup-api-client';

setupApiClient();

export function Main(type: 'popup' | 'options' = 'popup') {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <App type={type} />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

Main();
