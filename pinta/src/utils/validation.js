export const validators = {
  siret: (value) => {
    if (!value) return { valid: false, message: 'SIRET requis' };
    const cleaned = value.replace(/\s/g, '');
    if (!/^\d{14}$/.test(cleaned)) return { valid: false, message: 'SIRET doit contenir 14 chiffres' };
    return { valid: true };
  },
  
  telephone: (value) => {
    if (!value) return { valid: false, message: 'Téléphone requis' };
    const cleaned = value.replace(/[\s.-]/g, '');
    if (!/^(\+?\d{10,14})$/.test(cleaned)) return { valid: false, message: 'Numéro invalide' };
    return { valid: true };
  },
  
  codePostal: (value) => {
    if (!value) return { valid: true };
    if (!/^\d{5}$/.test(value)) return { valid: false, message: 'Code postal invalide' };
    return { valid: true };
  },
  
  email: (value) => {
    if (!value) return { valid: false, message: 'Email requis' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { valid: false, message: 'Email invalide' };
    return { valid: true };
  },
  
  required: (value, fieldName) => {
    if (!value || value.trim() === '') return { valid: false, message: `${fieldName} requis` };
    return { valid: true };
  },
  
  repartitionTotal: (repartition) => {
    const total = Object.values(repartition).reduce((a, b) => a + b, 0);
    if (total !== 100) return { valid: false, message: `Total doit être 100% (actuellement ${total}%)` };
    return { valid: true };
  }
};

export const validateStep = (step, formData) => {
  const errors = {};
  
  switch (step) {
    case 0: {
      const nomResult = validators.required(formData.nom, 'Nom');
      if (!nomResult.valid) errors.nom = nomResult.message;
      
      const prenomResult = validators.required(formData.prenom, 'Prénom');
      if (!prenomResult.valid) errors.prenom = prenomResult.message;
      
      const entrepriseResult = validators.required(formData.entreprise, 'Entreprise');
      if (!entrepriseResult.valid) errors.entreprise = entrepriseResult.message;
      
      const siretResult = validators.siret(formData.siret);
      if (!siretResult.valid) errors.siret = siretResult.message;
      
      const telResult = validators.telephone(formData.telephone);
      if (!telResult.valid) errors.telephone = telResult.message;
      
      const cpResult = validators.codePostal(formData.adresseCP);
      if (!cpResult.valid) errors.adresseCP = cpResult.message;
      break;
    }
      
    case 1: {
      const repartResult = validators.repartitionTotal(formData.repartition);
      if (!repartResult.valid) errors.repartition = repartResult.message;
      break;
    }
      
    default:
      break;
  }
  
  return errors;
};
