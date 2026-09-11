import {
  supabaseClient,
  supabaseRealtimeClient
} from "../supabase.js";

export async function subscribeTeamChanges({
  role,
  onChange=()=>{},
  onStatus=()=>{}
}){
  const tables=
    role==="admin"
      ? [
          "employees",
          "employee_points",
          "points",
          "point_tariffs",
          "shifts",
          "shift_bonuses",
          "shift_penalties",
          "employee_payouts"
        ]
      : [
          "employees",
          "shifts",
          "shift_bonuses",
          "shift_penalties",
          "employee_payouts"
        ];

  const sessionResult=
    await supabaseClient.auth
      .getSession();

  if(sessionResult.error){
    throw sessionResult.error;
  }

  const accessToken=
    sessionResult.data.session
      ?.access_token;

  if(accessToken){
    await supabaseRealtimeClient
      .realtime
      .setAuth(accessToken);
  }

  let channel=
    supabaseRealtimeClient.channel(
      `shift-register-${role}-${crypto.randomUUID()}`
    );

  tables.forEach(table=>{
    channel=channel.on(
      "postgres_changes",
      {
        event:"*",
        schema:"public",
        table
      },
      payload=>onChange({
        table,
        payload
      })
    );
  });

  channel.subscribe(
    status=>onStatus(status)
  );

  return ()=>{
    void supabaseRealtimeClient
      .removeChannel(channel);
  };
}
