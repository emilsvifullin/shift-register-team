const E164_PATTERN=/^\+[1-9]\d{7,14}$/;

const PHONE_AUTH_DOMAIN=
  "phone.shift-register.example.com";

export function normalizePhone(
  value
){
  const source=String(
    value ?? ""
  ).trim();

  if(!source){
    throw new Error(
      "Укажите номер телефона"
    );
  }

  const digits=source.replace(
    /\D/g,
    ""
  );

  let normalized;

  if(
    digits.length===11 &&
    digits.startsWith("8")
  ){
    normalized=
      "+7"+digits.slice(1);
  }else if(
    digits.length===10
  ){
    normalized=
      "+7"+digits;
  }else{
    normalized=
      "+"+digits;
  }

  if(!E164_PATTERN.test(normalized)){
    throw new Error(
      "Введите телефон с кодом страны"
    );
  }

  return normalized;
}

export function optionalPhone(
  value
){
  return String(value ?? "").trim()
    ? normalizePhone(value)
    : null;
}

export function phoneAuthEmail(
  value
){
  const phone=
    normalizePhone(value);

  return `${phone.slice(1)}@${PHONE_AUTH_DOMAIN}`;
}

export function phoneLabel(
  value
){
  const normalized=String(
    value ?? ""
  );

  const match=normalized.match(
    /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/
  );

  if(!match){
    return normalized;
  }

  return `+7 (${match[1]}) ${match[2]}-${match[3]}-${match[4]}`;
}
