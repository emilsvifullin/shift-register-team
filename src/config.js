import "./management-employee-points.js";
import "./management-tap-intent.js";
import "./management-navigation.js";

export const APP_VERSION = "6.22.26";
export const SCHEMA_VERSION = 3;
export const RULES_VERSION = "2026-08-12-v3";

export const POINT_DEFINITIONS = Object.freeze([
  {id:"kommunalnaya-10", name:"Коммунальная Улица 10"},
  {id:"radialnaya-3k11", name:"6-Я Радиальная 3к11"},
  {id:"novoyasenevskiy-22k1", name:"Новоясеневский Проспект 22к1"},
  {id:"kuzminskaya-5", name:"Кузьминская 5"},
  {id:"korabelnaya-1", name:"Корабельная 1"},
  {id:"nagatinskaya-56a", name:"Нагатинская Набережная 56а"},
  {id:"volgogradskiy-73s1", name:"Волгоградский Проспект 73с1"},
  {id:"yartsevskaya-6", name:"Ярцевская 6"},
  {id:"yartsevskaya-25a", name:"Ярцевская 25а"},
  {id:"pyatnitskiy-2", name:"Пятницкий Переулок 2"},
  {id:"mustaya-karima-12", name:"Мустая Карима 12"},
  {id:"kruzenshterna-9", name:"Крузенштерна 9"},
  {id:"bolshoy-ovchinnikovskiy-16", name:"Большой Овчинниковский Переулок 16"},
  {id:"prokatnaya-2", name:"Прокатная 2"}
]);

export const POINTS = Object.freeze(POINT_DEFINITIONS.map(point=>point.name));
export const POINT_IDS = new Set(POINT_DEFINITIONS.map(point=>point.id));
export const POINT_BY_ID = new Map(POINT_DEFINITIONS.map(point=>[point.id,point]));
export const POINT_BY_NAME = new Map(POINT_DEFINITIONS.map(point=>[point.name,point]));

export const FIXED_POINT_IDS = new Set([
  "radialnaya-3k11",
  "korabelnaya-1",
  "nagatinskaya-56a",
  "mustaya-karima-12",
  "kruzenshterna-9"
]);

export const ADVANCE_POINT_IDS = new Set([
  "volgogradskiy-73s1",
  "yartsevskaya-6",
  "yartsevskaya-25a",
  "pyatnitskiy-2",
  "prokatnaya-2"
]);

export const MONTHS = [
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"
];
export const MONTHS_G = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря"
];
export const WD = ["вс","пн","вт","ср","чт","пт","сб"];

export const FULL_HOURS = 12;
export const ADVANCE_CAP = 10000;
export const MIN_YEAR = 2024;
export const MAX_YEAR = 2035;
export const MAX_SHK = 1000000;
export const MAX_MONEY = 10000000;
