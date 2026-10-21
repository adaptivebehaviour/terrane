import { defineCollection } from '@adaptivebehaviour/manifesto/src/registry';
import { validateRecordsJson } from '@adaptivebehaviour/manifesto/src/schema';
import records from './records.json';

function register(): void {
  validateRecordsJson('terrane/records.json', records);
}

export const terrane = defineCollection({ id: 'terrane', dependsOn: ['manifesto'], register });
