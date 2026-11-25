import type { CheckedDataset, CheckedPlaceRecord, Weekday } from "./types.js";

function allDays(window: string): Record<Weekday, string> {
  return {
    sunday: window,
    monday: window,
    tuesday: window,
    wednesday: window,
    thursday: window,
    friday: window,
    saturday: window,
  };
}

export function createDefaultCheckedDataset(): CheckedDataset {
  const placesList: CheckedPlaceRecord[] = [
    {
      placeId: "plc_hcmc_014",
      placeName: "Phở Hòa Pasteur",
      district: "District 3",
      isOutdoor: false,
      ticketPriceVnd: 0,
      openingHoursByWeekday: allDays("06:00-22:00"),
      menuItems: [
        { menuItemId: "itm_phohoa_01", itemName: "Phở tái nạm", unitPriceVnd: 95_000 },
        { menuItemId: "itm_phohoa_04", itemName: "Trà đá", unitPriceVnd: 10_000 },
        {
          menuItemId: "itm_phohoa_odd",
          itemName: "Phần ăn lẻ thử làm tròn",
          unitPriceVnd: 100_001,
        },
      ],
    },
    {
      placeId: "plc_hcmc_003",
      placeName: "Dinh Độc Lập",
      district: "District 1",
      isOutdoor: false,
      ticketPriceVnd: 40_000,
      openingHoursByWeekday: allDays("08:00-16:30"),
      menuItems: [],
      closedDates: ["2026-11-30"],
    },
    {
      placeId: "plc_hcmc_042",
      placeName: "Cà Phê Vợt Cheo Leo",
      district: "District 3",
      isOutdoor: false,
      ticketPriceVnd: 0,
      openingHoursByWeekday: allDays("05:30-18:30"),
      menuItems: [
        { menuItemId: "itm_cheoleo_01", itemName: "Cà phê sữa đá", unitPriceVnd: 35_000 },
      ],
    },
    {
      placeId: "plc_hcmc_088",
      placeName: "Công Viên Bến Bạch Đằng",
      district: "District 1",
      isOutdoor: true,
      ticketPriceVnd: 0,
      openingHoursByWeekday: allDays("05:00-23:00"),
      menuItems: [],
    },
    {
      placeId: "plc_hcmc_099",
      placeName: "Saigon Sky Dining",
      district: "District 1",
      isOutdoor: false,
      ticketPriceVnd: 200_000,
      openingHoursByWeekday: allDays("10:00-23:00"),
      menuItems: [
        { menuItemId: "itm_sky_01", itemName: "Tasting Menu", unitPriceVnd: 900_000 },
        { menuItemId: "itm_sky_02", itemName: "Signature Mocktail", unitPriceVnd: 120_000 },
      ],
    },
    {
      placeId: "plc_hcmc_no_hours",
      placeName: "Quán Chưa Cập Nhật Giờ Mở Cửa",
      district: "District 1",
      isOutdoor: false,
      ticketPriceVnd: 0,
      openingHoursByWeekday: null,
      menuItems: [],
    },
    {
      placeId: "plc_hcmc_no_menu",
      placeName: "Quán Chưa Cập Nhật Menu",
      district: "District 3",
      isOutdoor: false,
      ticketPriceVnd: 0,
      openingHoursByWeekday: allDays("07:00-21:00"),
      menuItems: null,
    },
  ];

  const places = new Map<string, CheckedPlaceRecord>();
  for (const place of placesList) {
    places.set(place.placeId, place);
  }

  const travelMinutesMatrix = new Map<string, number>([
    ["plc_hcmc_014->plc_hcmc_003", 12],
    ["plc_hcmc_003->plc_hcmc_014", 12],
    ["plc_hcmc_003->plc_hcmc_042", 15],
    ["plc_hcmc_042->plc_hcmc_003", 15],
    ["plc_hcmc_003->plc_hcmc_088", 28],
    ["plc_hcmc_088->plc_hcmc_003", 28],
    ["plc_hcmc_014->plc_hcmc_088", 20],
    ["plc_hcmc_088->plc_hcmc_014", 20],
    ["plc_hcmc_014->plc_hcmc_042", 10],
    ["plc_hcmc_042->plc_hcmc_014", 10],
    ["plc_hcmc_042->plc_hcmc_088", 22],
    ["plc_hcmc_088->plc_hcmc_042", 22],
    ["plc_hcmc_003->plc_hcmc_099", 10],
    ["plc_hcmc_099->plc_hcmc_003", 10],
    ["plc_hcmc_014->plc_hcmc_099", 15],
    ["plc_hcmc_099->plc_hcmc_014", 15],
  ]);

  const hourlyRainForecast = new Map<string, Record<string, number>>([
    [
      "2026-11-28",
      {
        "06:00": 10,
        "07:00": 10,
        "08:00": 15,
        "09:00": 15,
        "10:00": 20,
        "11:00": 20,
        "12:00": 30,
        "13:00": 65,
        "14:00": 72,
        "15:00": 50,
        "16:00": 60,
        "17:00": 75,
        "18:00": 40,
        "19:00": 25,
        "20:00": 20,
      },
    ],
    [
      "2026-11-29",
      {
        "08:00": 10,
        "09:00": 10,
        "10:00": 15,
        "11:00": 15,
        "12:00": 20,
        "13:00": 25,
        "14:00": 30,
        "15:00": 35,
        "16:00": 40,
        "17:00": 30,
      },
    ],
    [
      "2026-11-30",
      {
        "08:00": 10,
        "09:00": 10,
        "10:00": 15,
        "11:00": 15,
      },
    ],
  ]);

  const publicHolidays = new Set<string>(["2026-11-30"]);

  return {
    places,
    travelMinutesMatrix,
    hourlyRainForecast,
    publicHolidays,
  };
}
