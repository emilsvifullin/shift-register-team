import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  createClient
} from "npm:@supabase/supabase-js@2.112.3";

const CORS_HEADERS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};

function json(
  body:Record<string,unknown>,
  status=200
){
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers:{
        ...CORS_HEADERS,
        "Content-Type":"application/json; charset=utf-8"
      }
    }
  );
}

function validUuid(value:unknown){
  return typeof value==="string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value);
}

function validPhone(value:unknown){
  return typeof value==="string" &&
    /^\+[1-9]\d{7,14}$/.test(value);
}

function phoneAuthEmail(
  phone:string
){
  return (
    `${phone.slice(1)}`+
    "@phone.shift-register.example.com"
  );
}

Deno.serve(async request=>{
  if(request.method==="OPTIONS"){
    return new Response(
      "ok",
      {
        headers:CORS_HEADERS
      }
    );
  }

  if(request.method!=="POST"){
    return json(
      {error:"method_not_allowed"},
      405
    );
  }

  const supabaseUrl=
    Deno.env.get("SUPABASE_URL");
  const publishableKey=
    Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey=
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization=
    request.headers.get("Authorization");

  if(
    !supabaseUrl ||
    !publishableKey ||
    !serviceRoleKey ||
    !authorization
  ){
    return json(
      {error:"unauthorized"},
      401
    );
  }

  const userClient=createClient(
    supabaseUrl,
    publishableKey,
    {
      global:{
        headers:{
          Authorization:authorization
        }
      },
      auth:{
        persistSession:false,
        autoRefreshToken:false
      }
    }
  );

  const {
    data:userData,
    error:userError
  }=await userClient.auth.getUser();

  if(userError || !userData.user){
    return json(
      {error:"unauthorized"},
      401
    );
  }

  const adminClient=createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth:{
        persistSession:false,
        autoRefreshToken:false
      }
    }
  );

  const {
    data:profile,
    error:profileError
  }=await adminClient
    .from("profiles")
    .select("role")
    .eq("id",userData.user.id)
    .maybeSingle();

  if(
    profileError ||
    profile?.role!=="admin"
  ){
    return json(
      {error:"forbidden"},
      403
    );
  }

  let payload:Record<string,unknown>;

  try{
    payload=await request.json();
  }catch{
    return json(
      {error:"invalid_json"},
      400
    );
  }

  const employeeId=payload.employeeId;
  const phone=payload.phone;
  const email=
    typeof phone==="string"
      ? phoneAuthEmail(phone)
      : "";
  const password=
    typeof payload.password==="string"
      ? payload.password
      : "";

  if(
    !validUuid(employeeId) ||
    !validPhone(phone) ||
    (
      password &&
      (
        password.length<8 ||
        password.length>72
      )
    )
  ){
    return json(
      {error:"invalid_employee_auth_payload"},
      400
    );
  }

  const {
    data:employee,
    error:employeeError
  }=await adminClient
    .from("employees")
    .select("id, user_id")
    .eq("id",employeeId)
    .maybeSingle();

  if(employeeError || !employee){
    return json(
      {error:"employee_not_found"},
      404
    );
  }

  let authUserId=employee.user_id;
  let created=false;

  if(authUserId){
    const {
      data:existingUser,
      error:getUserError
    }=await adminClient.auth.admin
      .getUserById(authUserId);

    if(getUserError || !existingUser.user){
      return json(
        {error:"employee_auth_user_not_found"},
        404
      );
    }

    const updatePayload:Record<string,unknown>={
      email,
      email_confirm:true,
      app_metadata:{
        ...existingUser.user.app_metadata,
        role:"employee"
      }
    };

    if(password){
      updatePayload.password=password;
    }

    const {error:updateError}=
      await adminClient.auth.admin
        .updateUserById(
          authUserId,
          updatePayload
        );

    if(updateError){
      return json(
        {
          error:
            updateError.code ||
            "employee_auth_update_failed"
        },
        409
      );
    }
  }else{
    if(!password){
      return json(
        {error:"password_required_for_new_account"},
        400
      );
    }

    const {
      data:createdUser,
      error:createError
    }=await adminClient.auth.admin
      .createUser({
        email,
        password,
        email_confirm:true,
        app_metadata:{
          role:"employee"
        }
      });

    if(createError || !createdUser.user){
      return json(
        {
          error:
            createError?.code ||
            "employee_auth_create_failed"
        },
        409
      );
    }

    authUserId=createdUser.user.id;
    created=true;
  }

  const {error:profileSaveError}=
    await adminClient
      .from("profiles")
      .upsert({
        id:authUserId,
        role:"employee"
      });

  const {error:employeeSaveError}=
    await adminClient
      .from("employees")
      .update({
        user_id:authUserId,
        phone
      })
      .eq("id",employeeId);

  if(profileSaveError || employeeSaveError){
    if(created){
      await adminClient.auth.admin
        .deleteUser(authUserId);
    }

    return json(
      {error:"employee_auth_link_failed"},
      500
    );
  }

  return json({
    ok:true,
    created,
    userId:authUserId,
    login:phone
  });
});
