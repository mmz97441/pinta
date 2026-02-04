import { Building2, BarChart3, ClipboardCheck, Truck, Database, Target } from 'lucide-react';

export const INITIAL_FORM_DATA = {
  // Identité
  nom: '',
  prenom: '',
  entreprise: '',
  siret: '',
  telephone: '',
  adresseRue: '',
  adresseCP: '',
  adresseVille: '',
  
  // Vision
  repartition: { grosOeuvre: 0, tp: 0, amenagement: 0, maintenance: 0 },
  dependancePublique: 0, 
  priorites: { excellence: '', developpement: '', rse: '' },
  
  // Marchés
  cctpPages: '',
  risqueConformite: '',
  memoireTechnique: '',
  
  // Logistique
  optimisationTournees: '',
  contraintesCirculation: '',
  gestionRessources: '',
  
  // Data
  systemeCloud: '',
  suiviFlotte: '',
  qualiteAdresses: '',
  
  // Priorisation IA
  valeurTournees: 5,
  valeurCctp: 5,
  valeurCouts: 5,
  valeurAleas: 5
};

export const STEPS = [
  { title: "Identité", icon: Building2 },
  { title: "Vision", icon: BarChart3 },
  { title: "Marchés", icon: ClipboardCheck },
  { title: "Logistique", icon: Truck },
  { title: "Data & Tech", icon: Database },
  { title: "Priorités IA", icon: Target }
];

export const STORAGE_KEY = 'pinta-diagnostic-form';

export const ACTIVITE_ITEMS = [
  { key: 'grosOeuvre', label: "Gros Œuvre / Génie Civil" },
  { key: 'tp', label: "Travaux Publics / VRD" },
  { key: 'amenagement', label: "Aménagements / Paysagisme" },
  { key: 'maintenance', label: "Maintenance / Entretien" }
];

export const PRIORITES_ITEMS = [
  { key: 'excellence', label: "Excellence Opérationnelle (Coûts/Logistique)" },
  { key: 'developpement', label: "Développement Commercial (Appels d'offres)" },
  { key: 'rse', label: "Sécurité & RSE (Empreinte carbone)" }
];

export const RANGS = ["1 (Top)", "2", "3"];

export const IA_VALUE_ITEMS = [
  { key: 'valeurTournees', label: 'Optimisation automatisée des tournées (Réduction Carburant/Temps)' },
  { key: 'valeurCctp', label: 'Analyse automatisée des CCTP / Appels d\'offres' },
  { key: 'valeurCouts', label: 'Prévision des coûts et des marges à terminaison' },
  { key: 'valeurAleas', label: 'Aide à la décision face aux aléas climatiques (Réunion)' }
];
