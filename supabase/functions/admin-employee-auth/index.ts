import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  createClient
} from "npm:@supabase/supabase-js@2.112.3";

const ALLOWED_ORIGINS=new Set([
  "https://shiftregister.ru",
  "https://www.shiftregister.ru",
  "https://emilsvifullin.github.io",
  "https://shift-register-project-ready.emilsvifullin.chatgpt.site",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
]);

const DEFAULT_CORS_HEADERS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
  "Vary":"Origin"
};

function corsHeaders(
  request:Request
){
  const origin=
    request.headers.get("Origin");

  return {
    ...DEFAULT_CORS_HEADERS,
    ...(origin &&
      ALLOWED_ORIGINS.has(origin)
      ? {
          "Access-Control-Allow-Origin":
            origin
        }
      : {})
  };
}

function json(
  body:Record<string,unknown>,
  status=200,
  headers:Record<string,string>=
    DEFAULT_CORS_HEADERS
){
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers:{
        ...headers,
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

function normalizedEmail(value:unknown){
  if(typeof value!=="string"){
    return "";
  }

  const email=value
    .trim()
    .toLowerCase();

  return email.length<=254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
      .test(email)
    ? email
    : "";
}

Deno.serve(async request=>{
  const origin=
    request.headers.get("Origin");

  if(
    origin &&
    !ALLOWED_ORIGINS.has(origin)
  ){
    return json(
      {error:"origin_not_allowed"},
      403
    );
  }

  if(request.method==="OPTIONS"){
    return new Response(
      "ok",
      {
        headers:corsHeaders(request)
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
  const action=
    payload.action==="delete"
      ? "delete"
      : "save";
  const email=normalizedEmail(
    payload.email
  );
  const password=
    typeof payload.password==="string"
      ? payload.password
      : "";

  if(
    !validUuid(employeeId) ||
    (
      action==="save" &&
      (
        !email ||
        (
          password &&
          (
            password.length<8 ||
            password.length>72
          )
        )
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
    .select(
      "id, user_id, full_name, status, deletion_pending"
    )
    .eq("id",employeeId)
    .maybeSingle();

  if(employeeError || !employee){
    return json(
      {error:"employee_not_found"},
      404
    );
  }

  if(action==="delete"){
    const {
      data:authUserId,
      error:beginDeleteError
    }=await userClient.rpc(
      "admin_begin_employee_deletion",
      {
        p_employee_id:employeeId
      }
    );

    if(beginDeleteError){
      return json(
        {
          error:
            beginDeleteError.message ||
            "employee_delete_begin_failed"
        },
        beginDeleteError.code==="23503"
          ? 409
          : beginDeleteError.code==="P0002"
            ? 404
            : beginDeleteError.code==="42501"
              ? 403
              : beginDeleteError.code==="55000"
                ? 409
                : 500
      );
    }

    if(authUserId){
      const {error:deleteUserError}=
        await adminClient.auth.admin
          .deleteUser(authUserId);

      if(deleteUserError){
        const {error:cancelDeleteError}=
          await userClient.rpc(
            "admin_cancel_employee_deletion",
            {
              p_employee_id:employeeId
            }
          );

        return json(
          {
            error:
              cancelDeleteError
                ? "employee_delete_cancel_failed"
                : (
                    deleteUserError.code ||
                    "employee_auth_delete_failed"
                  )
          },
          500
        );
      }
    }

    const {error:deleteEmployeeError}=
      await userClient.rpc(
        "admin_finalize_employee_deletion",
        {
          p_employee_id:employeeId
        }
      );

    if(deleteEmployeeError){
      return json(
        {
          error:
            deleteEmployeeError.message ||
            "employee_delete_finalize_failed"
        },
        deleteEmployeeError.code==="23503"
          ? 409
          : deleteEmployeeError.code==="P0002"
            ? 404
            : deleteEmployeeError.code==="42501"
              ? 403
              : deleteEmployeeError.code==="55000"
                ? 409
                : 500
      );
    }

    return json({
      ok:true,
      deleted:true,
      authDeleted:
        Boolean(authUserId)
    });
  }

  if(employee.deletion_pending){
    return json(
      {error:"employee_deletion_pending"},
      409
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

    const {
      data:linkedProfile,
      error:linkedProfileError
    }=await adminClient
      .from("profiles")
      .select("role")
      .eq("id",authUserId)
      .maybeSingle();

    if(linkedProfileError){
      return json(
        {error:"employee_profile_read_failed"},
        500
      );
    }

    if(linkedProfile?.role==="admin"){
      return json(
        {error:"admin_account_protected"},
        409
      );
    }

    const updatePayload:Record<string,unknown>={
      email,
      email_confirm:true,
      user_metadata:{
        ...existingUser.user.user_metadata,
        full_name:employee.full_name,
        display_name:employee.full_name
      },
      app_metadata:{
        ...existingUser.user.app_metadata,
        role:"employee"
      },
      ban_duration:
        employee.status==="inactive"
          ? "876000h"
          : "none"
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
        user_metadata:{
          full_name:employee.full_name,
          display_name:employee.full_name
        },
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

    if(employee.status==="inactive"){
      const {error:banError}=
        await adminClient.auth.admin
          .updateUserById(
            authUserId,
            {
              ban_duration:"876000h"
            }
          );

      if(banError){
        await adminClient.auth.admin
          .deleteUser(authUserId);

        return json(
          {error:"employee_auth_archive_failed"},
          500
        );
      }
    }
  }

  const {error:profileSaveError}=
    await adminClient
      .from("profiles")
      .upsert({
        id:authUserId,
        role:"employee"
      });

  const {
    data:linkedEmployee,
    error:employeeSaveError
  }=
    await adminClient
      .from("employees")
      .update({
        user_id:authUserId
      })
      .eq("id",employeeId)
      .select("id")
      .maybeSingle();

  if(
    profileSaveError ||
    employeeSaveError ||
    !linkedEmployee
  ){
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
    login:email
  });
});
