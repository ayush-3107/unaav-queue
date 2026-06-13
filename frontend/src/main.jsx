// src/main.jsx
import React       from 'react';
import ReactDOM    from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App         from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

console.log("main.jsx loaded");

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      {console.log("inside AuthProvider")}
      <App />
    </AuthProvider>
  </React.StrictMode>
);

// ReactDOM.createRoot(document.getElementById('root')).render(
//   <React.StrictMode>
//     <AuthProvider>
//       <App />
//       {/* Global toast notifications — positioned top-right */}
//       <Toaster
//         position="top-right"
//         toastOptions={{
//           duration: 3000,
//           style: {
//             fontSize:  '14px',
//             maxWidth:  '380px',
//           },
//           success: { iconTheme: { primary: '#0F6E56', secondary: '#fff' } },
//           error:   { iconTheme: { primary: '#DC2626', secondary: '#fff' } },
//         }}
//       />
//     </AuthProvider>
//   </React.StrictMode>
// );