import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationState, needsConversationAction, conversationLabel, messageDelivered, messageDeliveryLabel } from './conversations.js';

test('durable work state never disappears when all messages are read', () => {
  assert.equal(needsConversationAction({conversationStatut:'a_traiter',messages:[{type:'client',lu:true}]}),true);
  assert.equal(needsConversationAction({conversationStatut:'termine',messages:[{type:'client',lu:false}]}),false);
  assert.equal(conversationLabel({conversationStatut:'attente_client'}),'Attente client');
});
test('the three states use one set of labels', () => {
  assert.deepEqual(['a_traiter','attente_client','termine'].map(conversationLabel),['À répondre','Attente client','Traitée']);
});
test('legacy fallback is based on a delivered reply, never the read flag', () => {
  const customer={type:'client',lu:true,createdAt:'2026-09-10T10:00:00Z'};
  assert.equal(conversationState({messages:[customer]}),'a_traiter');
  assert.equal(conversationState({messages:[customer,{type:'staff',statut:'envoi',createdAt:'2026-09-10T11:00:00Z'}]}),'a_traiter');
  assert.equal(conversationState({messages:[customer,{type:'staff',statut:'envoye',createdAt:'2026-09-10T11:00:00Z'}]}),'termine');
});
test('structured approval and wait are already handled, refusal needs follow-up', () => {
  for(const template of ['client_decision_approve','client_decision_wait']) assert.equal(conversationState({messages:[{type:'client',template}]}),'termine');
  assert.equal(conversationState({messages:[{type:'client',template:'client_decision_refuse'}]}),'a_traiter');
});
test('a message counts as sent only once delivered, and its state reads the same everywhere', () => {
  for(const statut of ['envoye','distribue','lu']) assert.equal(messageDelivered({statut}),true,statut);
  for(const statut of ['envoi','echec','en_attente',undefined]) assert.equal(messageDelivered({statut}),false,String(statut));
  assert.deepEqual(['envoi','envoye','distribue','lu','echec','en_attente'].map(statut=>messageDeliveryLabel({statut,canal:'telegram'})),['En attente de livraison','Envoyé','Distribué','Lu','Envoi non confirmé','En attente de connexion Telegram']);
  assert.equal(messageDeliveryLabel({statut:'envoi',canal:'email'}),'Brouillon manuel','No business e-mail provider: an e-mail stays a manual draft.');
  assert.equal(messageDeliveryLabel({}),null);assert.equal(messageDeliveryLabel(null),null);
});
