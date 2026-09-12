export const APP_VERSION = "6.22.1";
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
  "bolshoy-ovchinnikovskiy-16",
  "prokatnaya-2"
]);

export const FIXED_RATE = 3000;
export const ADVANCE_CAP = 25000;
export const FULL_HOURS = 12;
export const MIN_YEAR = 2020;
export const MAX_YEAR = 2100;
export const MAX_SHK = 1000000;
export const MAX_MONEY = 100000000;

export const SHK_TIERS = Object.freeze([
  {min:0,max:0,rate:3000},
  {min:1,max:199,rate:3000},
  {min:200,max:299,rate:3500},
  {min:300,max:399,rate:4000},
  {min:400,max:499,rate:4500},
  {min:500,max:599,rate:5000},
  {min:600,max:699,rate:5500},
  {min:700,max:799,rate:6000},
  {min:800,max:899,rate:6500},
  {min:900,max:999,rate:7000},
  {min:1000,max:1099,rate:7500},
  {min:1100,max:1199,rate:8000},
  {min:1200,max:1299,rate:8500},
  {min:1300,max:1399,rate:9000},
  {min:1400,max:1499,rate:9500},
  {min:1500,max:1599,rate:10000},
  {min:1600,max:1699,rate:10500},
  {min:1700,max:1799,rate:11000},
  {min:1800,max:1899,rate:11500},
  {min:1900,max:1999,rate:12000},
  {min:2000,max:2099,rate:12500},
  {min:2100,max:2199,rate:13000},
  {min:2200,max:2299,rate:13500},
  {min:2300,max:2399,rate:14000},
  {min:2400,max:2499,rate:14500},
  {min:2500,max:2599,rate:15000},
  {min:2600,max:2699,rate:15500},
  {min:2700,max:2799,rate:16000},
  {min:2800,max:2899,rate:16500},
  {min:2900,max:2999,rate:17000},
  {min:3000,max:3099,rate:17500},
  {min:3100,max:3199,rate:18000},
  {min:3200,max:3299,rate:18500},
  {min:3300,max:3399,rate:19000},
  {min:3400,max:3499,rate:19500},
  {min:3500,max:3599,rate:20000},
  {min:3600,max:3699,rate:20500},
  {min:3700,max:3799,rate:21000},
  {min:3800,max:3899,rate:21500},
  {min:3900,max:3999,rate:22000},
  {min:4000,max:4099,rate:22500},
  {min:4100,max:4199,rate:23000},
  {min:4200,max:4299,rate:23500},
  {min:4300,max:4399,rate:24000},
  {min:4400,max:4499,rate:24500},
  {min:4500,max:4599,rate:25000},
  {min:4600,max:4699,rate:25500},
  {min:4700,max:4799,rate:26000},
  {min:4800,max:4899,rate:26500},
  {min:4900,max:4999,rate:27000},
  {min:5000,max:5099,rate:27500},
  {min:5100,max:5199,rate:28000},
  {min:5200,max:5299,rate:28500},
  {min:5300,max:5399,rate:29000},
  {min:5400,max:5499,rate:29500},
  {min:5500,max:5599,rate:30000},
  {min:5600,max:5699,rate:30500},
  {min:5700,max:5799,rate:31000},
  {min:5800,max:5899,rate:31500},
  {min:5900,max:5999,rate:32000},
  {min:6000,max:6099,rate:32500},
  {min:6100,max:6199,rate:33000},
  {min:6200,max:6299,rate:33500},
  {min:6300,max:6399,rate:34000},
  {min:6400,max:6499,rate:34500},
  {min:6500,max:6599,rate:35000},
  {min:6600,max:6699,rate:35500},
  {min:6700,max:6799,rate:36000},
  {min:6800,max:6899,rate:36500},
  {min:6900,max:6999,rate:37000},
  {min:7000,max:7099,rate:37500},
  {min:7100,max:7199,rate:38000},
  {min:7200,max:7299,rate:38500},
  {min:7300,max:7399,rate:39000},
  {min:7400,max:7499,rate:39500},
  {min:7500,max:7599,rate:40000},
  {min:7600,max:7699,rate:40500},
  {min:7700,max:7799,rate:41000},
  {min:7800,max:7899,rate:41500},
  {min:7900,max:7999,rate:42000},
  {min:8000,max:8099,rate:42500},
  {min:8100,max:8199,rate:43000},
  {min:8200,max:8299,rate:43500},
  {min:8300,max:8399,rate:44000},
  {min:8400,max:8499,rate:44500},
  {min:8500,max:8599,rate:45000},
  {min:8600,max:8699,rate:45500},
  {min:8700,max:8799,rate:46000},
  {min:8800,max:8899,rate:46500},
  {min:8900,max:8999,rate:47000},
  {min:9000,max:9099,rate:47500},
  {min:9100,max:9199,rate:48000},
  {min:9200,max:9299,rate:48500},
  {min:9300,max:9399,rate:49000},
  {min:9400,max:9499,rate:49500},
  {min:9500,max:9599,rate:50000},
  {min:9600,max:9699,rate:50500},
  {min:9700,max:9799,rate:51000},
  {min:9800,max:9899,rate:51500},
  {min:9900,max:9999,rate:52000},
  {min:10000,max:Infinity,rate:52500}
]);

export const MONTHS = Object.freeze([
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"
]);

export const MONTHS_G = Object.freeze([
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря"
]);

export const WD = Object.freeze([
  "вс","пн","вт","ср","чт","пт","сб"
]);
