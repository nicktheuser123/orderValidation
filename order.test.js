const { getThing } = require("./bubbleClient");
const { calculateOrder } = require("./orderCalculator");
let order;
let result;

beforeAll(async () => {
  const ORDER_ID = "1770131248673x697951971927654400";

  order = await getThing("GP_Order", ORDER_ID);

  const addOns = await Promise.all(
    order["Add Ons"].map(id => getThing("GP_AddOn", id))
  );

  const promotion = order.GP_Promotion
    ? await getThing("GP_Promotion", order.GP_Promotion)
    : null;

  const event = await getThing("event", order.Event);
  const eventDetail = await getThing(
    "GP_EventDetail",
    event.GP_EventDetail
  );

  const ticketTypes = {};
  for (const addOn of addOns) {
    if (addOn["OS AddOnType"] !== "Ticket") continue;

    const ticketTypeId = addOn.GP_TicketType;
    if (!ticketTypes[ticketTypeId]) {
      ticketTypes[ticketTypeId] = await getThing(
        "GP_TicketType",
        ticketTypeId
      );
    }
  }

  result = calculateOrder({
    order,
    addOns,
    promotion,
    ticketTypes,
    eventDetail
  });
});


describe("GP_Order financial validation", () => {

  it("validates Ticket Count", () => {
    expect(order["Ticket Count"]).toBe(result.ticketCount);
  });

  it("validates Gross Amount", () => {
    expect(order["Gross Amount"]).toBeCloseTo(result.grossAmount, 2);
  });

  it("validates Discount Amount", () => {
    // If GP_Promotion is empty, discount should be 0/undefined/empty and test should pass
    if (!order.GP_Promotion || order.GP_Promotion === "" || order.GP_Promotion === null) {
      // When there's no promotion, discountTotal should be 0
      expect(result.discountTotal).toBe(0);
      // Order's Discount Amount should be 0, undefined, null, or empty string
      const orderDiscount = order["Discount Amount"];
      expect(
        orderDiscount === 0 || 
        orderDiscount === undefined || 
        orderDiscount === null || 
        orderDiscount === ""
      ).toBe(true);
    } else {
      // Normal validation when promotion exists
      expect(order["Discount Amount"]).toBeCloseTo(result.discountTotal, 2);
    }
  });

  it("validates Processing Fee Revenue", () => {
    expect(order["Processing Fee Revenue"])
      .toBeCloseTo(result.processingFeeRevenue, 2);
  });

  it("validates Processing Fee Deduction", () => {
    expect(order["Processing Fee Deduction"])
      .toBeCloseTo(result.stripeDeduction, 2);
  });

  it("validates Total Order Value", () => {
    expect(order["Total Order Value"])
      .toBeCloseTo(result.totalOrderValue, 2);
  });

});
