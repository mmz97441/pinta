import React from 'react';
import { CheckCircle2, FileJson } from 'lucide-react';

const ConfirmationScreen = ({ formData, onDownload, onReset }) => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
    <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-200">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <CheckCircle2 className="w-10 h-10 text-green-600" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Diagnostic Transmis</h1>
      <p className="text-slate-600 mb-8">
        Merci {formData.prenom}. Les données ont été consolidées pour votre CODIR.
      </p>
      
      <div className="space-y-3">
        <button 
          onClick={onDownload} 
          className="w-full bg-slate-800 text-white px-6 py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
        >
          <FileJson className="w-5 h-5" aria-hidden="true" /> Télécharger les données (JSON)
        </button>
        
        <button 
          onClick={onReset} 
          className="w-full bg-white text-slate-600 px-6 py-3 rounded-xl font-bold border border-slate-200 hover:bg-slate-50 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
        >
          Nouveau diagnostic
        </button>
      </div>
    </div>
  </div>
);

export default ConfirmationScreen;
