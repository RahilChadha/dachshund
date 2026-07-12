/**
 * ~30 real make/model WMIs for vehicles commonly sold in Canada, spanning
 * North American, Japanese, Korean, and German manufacturers. WMIs (first 3
 * VIN chars) are real-world values; VDS (positions 4-8) are plausible but
 * not decoded against corgi's exact tables — good enough to exercise
 * check-digit logic, WMI-based decode_cache batching, and realistic
 * make/model/trim distributions without needing to reverse-engineer every
 * manufacturer's exact position-by-position VDS spec.
 */

export interface SeedVehicle {
  wmi: string;
  vds: string;
  plant: string;
  make: string;
  model: string;
  bodyStyle: string;
  fuelType: string;
  trims: string[];
  yearRange: [number, number];
  basePrice: number; // typical CAD price at model-year midpoint, used to scale price generation
}

export const SEED_VEHICLES: SeedVehicle[] = [
  { wmi: "1VW", vds: "BH7A3", plant: "C", make: "Volkswagen", model: "Passat", bodyStyle: "sedan", fuelType: "gasoline", trims: ["Comfortline", "Highline", "Trendline"], yearRange: [2012, 2019], basePrice: 24000 },
  { wmi: "1HG", vds: "CM826", plant: "A", make: "Honda", model: "Accord", bodyStyle: "sedan", fuelType: "gasoline", trims: ["LX", "EX", "EX-L", "Touring"], yearRange: [2013, 2024], basePrice: 31000 },
  { wmi: "2HG", vds: "FC2F5", plant: "H", make: "Honda", model: "Civic", bodyStyle: "sedan", fuelType: "gasoline", trims: ["LX", "Sport", "EX", "Touring"], yearRange: [2016, 2024], basePrice: 25500 },
  { wmi: "5J6", vds: "RM4H7", plant: "L", make: "Honda", model: "CR-V", bodyStyle: "suv", fuelType: "gasoline", trims: ["LX", "EX", "EX-L", "Touring"], yearRange: [2015, 2024], basePrice: 33500 },
  { wmi: "1FT", vds: "FW1ET", plant: "D", make: "Ford", model: "F-150", bodyStyle: "pickup", fuelType: "gasoline", trims: ["XL", "XLT", "Lariat", "Platinum"], yearRange: [2013, 2024], basePrice: 48000 },
  { wmi: "1FM", vds: "CU9GD", plant: "U", make: "Ford", model: "Escape", bodyStyle: "suv", fuelType: "gasoline", trims: ["S", "SE", "SEL", "Titanium"], yearRange: [2014, 2024], basePrice: 30000 },
  { wmi: "1FA", vds: "6P8TH", plant: "J", make: "Ford", model: "Mustang", bodyStyle: "coupe", fuelType: "gasoline", trims: ["EcoBoost", "GT", "GT Premium"], yearRange: [2015, 2024], basePrice: 42000 },
  { wmi: "1G1", vds: "ZE5ST", plant: "8", make: "Chevrolet", model: "Malibu", bodyStyle: "sedan", fuelType: "gasoline", trims: ["LS", "LT", "Premier"], yearRange: [2013, 2023], basePrice: 27000 },
  { wmi: "1GN", vds: "SKBKC", plant: "5", make: "Chevrolet", model: "Tahoe", bodyStyle: "suv", fuelType: "gasoline", trims: ["LS", "LT", "Premier", "High Country"], yearRange: [2015, 2024], basePrice: 62000 },
  { wmi: "3GN", vds: "AXUEV", plant: "7", make: "Chevrolet", model: "Equinox", bodyStyle: "suv", fuelType: "gasoline", trims: ["LS", "LT", "Premier"], yearRange: [2016, 2024], basePrice: 29500 },
  { wmi: "1C4", vds: "RJFAG", plant: "0", make: "Jeep", model: "Grand Cherokee", bodyStyle: "suv", fuelType: "gasoline", trims: ["Laredo", "Limited", "Overland", "Trailhawk"], yearRange: [2014, 2024], basePrice: 46000 },
  { wmi: "1C6", vds: "RR7LT", plant: "0", make: "Ram", model: "1500", bodyStyle: "pickup", fuelType: "gasoline", trims: ["Tradesman", "Big Horn", "Laramie", "Rebel"], yearRange: [2015, 2024], basePrice: 51000 },
  { wmi: "JTD", vds: "KN3DU", plant: "8", make: "Toyota", model: "Corolla", bodyStyle: "sedan", fuelType: "gasoline", trims: ["L", "LE", "SE", "XSE"], yearRange: [2014, 2024], basePrice: 23500 },
  { wmi: "4T1", vds: "BF1FK", plant: "5", make: "Toyota", model: "Camry", bodyStyle: "sedan", fuelType: "gasoline", trims: ["LE", "SE", "XLE", "XSE"], yearRange: [2013, 2024], basePrice: 30000 },
  { wmi: "2T1", vds: "BURHE", plant: "0", make: "Toyota", model: "Corolla", bodyStyle: "sedan", fuelType: "gasoline", trims: ["L", "LE", "SE"], yearRange: [2014, 2019], basePrice: 21500 },
  { wmi: "JHL", vds: "RE387", plant: "9", make: "Honda", model: "CR-V", bodyStyle: "suv", fuelType: "gasoline", trims: ["LX", "EX"], yearRange: [2012, 2016], basePrice: 26000 },
  { wmi: "JN1", vds: "AZ4EH", plant: "M", make: "Nissan", model: "Altima", bodyStyle: "sedan", fuelType: "gasoline", trims: ["S", "SV", "SL", "Platinum"], yearRange: [2013, 2023], basePrice: 27500 },
  { wmi: "1N4", vds: "AL3AP", plant: "J", make: "Nissan", model: "Altima", bodyStyle: "sedan", fuelType: "gasoline", trims: ["S", "SV", "SR"], yearRange: [2013, 2018], basePrice: 24000 },
  { wmi: "5N1", vds: "AT2MV", plant: "8", make: "Nissan", model: "Rogue", bodyStyle: "suv", fuelType: "gasoline", trims: ["S", "SV", "SL", "Platinum"], yearRange: [2014, 2024], basePrice: 31500 },
  { wmi: "5NP", vds: "E24AF", plant: "9", make: "Hyundai", model: "Sonata", bodyStyle: "sedan", fuelType: "gasoline", trims: ["GL", "GLS", "Sport", "Limited"], yearRange: [2015, 2023], basePrice: 28000 },
  { wmi: "KMH", vds: "DH4AE", plant: "0", make: "Hyundai", model: "Elantra", bodyStyle: "sedan", fuelType: "gasoline", trims: ["Essential", "Preferred", "Ultimate"], yearRange: [2014, 2024], basePrice: 22500 },
  { wmi: "KND", vds: "PB3AC", plant: "5", make: "Kia", model: "Sorento", bodyStyle: "suv", fuelType: "gasoline", trims: ["LX", "EX", "SX"], yearRange: [2015, 2024], basePrice: 37000 },
  { wmi: "3KP", vds: "FK4A7", plant: "5", make: "Kia", model: "Forte", bodyStyle: "sedan", fuelType: "gasoline", trims: ["LX", "EX", "GT"], yearRange: [2016, 2023], basePrice: 21000 },
  { wmi: "WBA", vds: "3B5C5", plant: "0", make: "BMW", model: "3 Series", bodyStyle: "sedan", fuelType: "gasoline", trims: ["330i", "330i xDrive", "M340i"], yearRange: [2013, 2024], basePrice: 48000 },
  { wmi: "WDD", vds: "GF4HB", plant: "6", make: "Mercedes-Benz", model: "C-Class", bodyStyle: "sedan", fuelType: "gasoline", trims: ["C300", "C300 4MATIC", "AMG C43"], yearRange: [2014, 2024], basePrice: 51000 },
  { wmi: "WVW", vds: "ZZZ1K", plant: "Z", make: "Volkswagen", model: "Golf", bodyStyle: "hatchback", fuelType: "gasoline", trims: ["Trendline", "Comfortline", "GTI", "R"], yearRange: [2015, 2023], basePrice: 26000 },
  { wmi: "WAU", vds: "AFAFL", plant: "3", make: "Audi", model: "A4", bodyStyle: "sedan", fuelType: "gasoline", trims: ["Komfort", "Progressiv", "Technik"], yearRange: [2013, 2024], basePrice: 47000 },
  { wmi: "YV1", vds: "RS58H", plant: "6", make: "Volvo", model: "XC60", bodyStyle: "suv", fuelType: "gasoline", trims: ["Momentum", "Inscription", "R-Design"], yearRange: [2014, 2024], basePrice: 45000 },
  { wmi: "2C3", vds: "CDXHG", plant: "H", make: "Dodge", model: "Charger", bodyStyle: "sedan", fuelType: "gasoline", trims: ["SXT", "GT", "R/T", "Scat Pack"], yearRange: [2015, 2023], basePrice: 39000 },
  { wmi: "5YJ", vds: "3E26A", plant: "7", make: "Tesla", model: "Model 3", bodyStyle: "sedan", fuelType: "electric", trims: ["Standard Range", "Long Range", "Performance"], yearRange: [2018, 2024], basePrice: 52000 },
];
