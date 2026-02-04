import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import { FormField, YesNoToggle, StepHeader } from '../ui';

const StepMarches = ({ formData, updateFormData }) => (
  <div className="space-y-8 animate-in">
    <StepHeader icon={ClipboardCheck} title="3. Levier 'Commande Publique'" />
    
    <div className="space-y-6">
      <FormField
        id="cctpPages"
        label="Analyse de Dossier (DCE) : Moyenne pages CCTP ?"
        type="number"
        value={formData.cctpPages}
        onChange={e => updateFormData('cctpPages', e.target.value)}
        placeholder="Ex: 150"
        className="max-w-[250px]"
      />
      
      <YesNoToggle
        id="risqueConformite"
        label="Risque de Conformité"
        description="Avez-vous déjà subi des litiges dus à une clause contractuelle mal interprétée en phase d'étude ?"
        value={formData.risqueConformite}
        onChange={(val) => updateFormData('risqueConformite', val)}
      />
      
      <YesNoToggle
        id="memoireTechnique"
        label="Mémoire Technique"
        description="Utilisez-vous des outils d'aide à la rédaction pour personnaliser vos réponses ?"
        value={formData.memoireTechnique}
        onChange={(val) => updateFormData('memoireTechnique', val)}
      />
    </div>
  </div>
);

export default StepMarches;
