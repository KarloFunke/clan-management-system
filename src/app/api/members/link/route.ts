import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { playerTag, personId, newPersonName } = await request.json();

    if (!playerTag) return NextResponse.json({ error: 'Player tag is required' }, { status: 400 });

    let finalPersonId = personId;

    // Create new person if requested; linking to an EXISTING person is an alt link.
    if (!personId && newPersonName) {
      const { data: newPerson, error: personError } = await supabase
        .from('persons')
        .insert([{ display_name: newPersonName }])
        .select()
        .single();

      if (personError) throw personError;
      finalPersonId = newPerson.id;
    }

    if (!finalPersonId) return NextResponse.json({ error: 'Person ID or New Person Name is required' }, { status: 400 });

    const { error: linkError } = await supabase
      .from('player_accounts')
      .update({ person_id: finalPersonId })
      .eq('player_tag', playerTag);

    if (linkError) throw linkError;

    return NextResponse.json({ success: true, personId: finalPersonId });

  } catch (error: any) {
    console.error('API Link Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
