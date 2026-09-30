import { supabase } from './supabase';

/** Whether a persona exists — confirms a note's target is real before insert. */
export async function personExists(personId: string): Promise<boolean> {
  const { data } = await supabase.from('persons').select('id').eq('id', personId).maybeSingle();
  return !!data;
}

/**
 * Add a note to a member's thread, attributed to the acting leader. Throws if the persona no longer
 * exists. Returns the inserted row.
 */
export async function addMemberNote(params: {
  personId: string;
  authorTag: string;
  body: string;
}) {
  const body = params.body?.trim();
  if (!body) throw new Error('Note body is required');
  if (!(await personExists(params.personId))) {
    throw new Error('Member not found');
  }
  const { data, error } = await supabase
    .from('member_notes')
    .insert([{ person_id: params.personId, author_tag: params.authorTag, body }])
    .select()
    .single();
  if (error) throw error;
  return data;
}
