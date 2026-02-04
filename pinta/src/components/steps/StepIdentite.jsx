import React from 'react';
import { Building2 } from 'lucide-react';
import { FormField, StepHeader, ErrorSummary } from '../ui';

const StepIdentite = ({ formData, updateFormData, errors }) => (
  <div className="space-y-8 animate-in">
    <StepHeader icon={Building2} title="1. Profil de l'Entreprise" />
    
    <ErrorSummary errors={errors} />
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <FormField
        id="nom"
        label="Nom"
        value={formData.nom}
        onChange={e => updateFormData('nom', e.target.value)}
        error={errors.nom}
        placeholder="Votre nom"
        required
      />
      <FormField
        id="prenom"
        label="Prénom"
        value={formData.prenom}
        onChange={e => updateFormData('prenom', e.target.value)}
        error={errors.prenom}
        placeholder="Votre prénom"
        required
      />
      <FormField
        id="entreprise"
        label="Entreprise"
        value={formData.entreprise}
        onChange={e => updateFormData('entreprise', e.target.value)}
        error={errors.entreprise}
        className="md:col-span-2"
        required
      />
      <FormField
        id="siret"
        label="SIRET"
        value={formData.siret}
        onChange={e => updateFormData('siret', e.target.value)}
        error={errors.siret}
        placeholder="14 chiffres"
        inputMode="numeric"
        maxLength={14}
        helpText="Numéro à 14 chiffres"
        required
      />
      <FormField
        id="telephone"
        label="Téléphone"
        type="tel"
        value={formData.telephone}
        onChange={e => updateFormData('telephone', e.target.value)}
        error={errors.telephone}
        placeholder="06 12 34 56 78"
        required
      />
      
      <div className="md:col-span-2 space-y-4 pt-2">
        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
          <FormField
            id="adresseRue"
            label="N° et Rue"
            value={formData.adresseRue}
            onChange={e => updateFormData('adresseRue', e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField
              id="adresseCP"
              label="Code Postal"
              value={formData.adresseCP}
              onChange={e => updateFormData('adresseCP', e.target.value)}
              error={errors.adresseCP}
              inputMode="numeric"
              maxLength={5}
            />
            <FormField
              id="adresseVille"
              label="Ville"
              value={formData.adresseVille}
              onChange={e => updateFormData('adresseVille', e.target.value)}
              className="sm:col-span-2"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default StepIdentite;
