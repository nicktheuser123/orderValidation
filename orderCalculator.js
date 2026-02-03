const { money, logSection } = require("./logger");

function calculateOrder({
  order,
  addOns,
  promotion,
  ticketTypes,
  eventDetail
}) {
  let ticketCount = 0;
  // Gross amount is (ticket price * qty + service fee) WITHOUT discount deduction
  let grossAmount = 0;
  // Final amount is (ticket price * qty + service fee - discount) AFTER discount deduction
  let finalAmount = 0;
  let discountTotal = 0;
  let discountAppliedToOrder = false; // Track if discount has been applied to this order

  logSection("ORDER CALCULATION START");

  // console.log("Order ID:", order._id);
  console.log("Promotion:", promotion ? `${promotion._id} (Type: ${promotion["OS GP Promotion Type"]}, Amount: ${promotion.DiscountAmt || "N/A"}, Pct: ${promotion.DiscountPct || "N/A"})` : "None");

addOns.forEach((addOn, index) => {
  // 🚨 HARD SKIP — FIRST LINE
  if (addOn["OS AddOnType"] !== "Ticket") {
    // console.log(
    //   `Skipping AddOn ${addOn._id} — type: ${addOn["OS AddOnType"]}`
    // );
    return;
  }

  const ticketType = ticketTypes[addOn.GP_TicketType];

  if (!ticketType) {
    throw new Error(
      `TicketType not loaded for Ticket AddOn ${addOn._id}`
    );
  }
  console.log("ADDON QTY",addOn.Quantity)
  const qty = addOn.Quantity;
  const ticketPrice = ticketType.Price;

  ticketCount += qty;

  const serviceFee = 2 * qty;

  let discount = 0;
  let discountApplied = false;

  if (
    promotion &&
    ticketType.GP_Promotions?.includes(promotion._id)
  ) {
    discountApplied = true;

    if (promotion["OS GP Promotion Type"] === "Discount Amount") {
      // Fixed amount discounts are applied once per order, not per addOn
      if (!discountAppliedToOrder) {
        discount = promotion.DiscountAmt;
        discountAppliedToOrder = true; // Mark that discount has been applied
        console.log(`  → Applying Discount Amount: ${money(promotion.DiscountAmt)} (once per order)`);
      } else {
        console.log(`  → Discount Amount already applied to this order, skipping`);
      }
    }

    if (promotion["OS GP Promotion Type"] === "Discount Percentage") {
      // Percentage discounts are applied per addOn
      discount = (ticketPrice * qty) * (promotion.DiscountPct);
      console.log(`  → Applying Discount Percentage: ${promotion.DiscountPct} on ${money(ticketPrice * qty)} = ${money(discount)} per addOn`);
    }
  } else if (promotion) {
    console.log(`  → Promotion exists but not applicable to this ticket type`);
  }

  discountTotal += discount;

  const addOnGross = (ticketPrice * qty) + serviceFee;
  const addOnFinal = addOnGross - discount;

  grossAmount += addOnGross;
  finalAmount += addOnFinal;

  console.log(`\nAddOn #${index + 1} (Ticket)`);
  console.log("AddOn ID:", addOn._id);
  console.log("Qty:", qty);
  console.log("Ticket Price:", money(ticketPrice));
  console.log("Service Fee:", money(serviceFee));
  console.log("Discount:", money(discount));
  console.log("AddOn Gross (before discount):", money(addOnGross));
  console.log("AddOn Final (after discount):", money(addOnFinal));
});


  logSection("FEES");

  // Processing fee revenue is calculated on totalOrderValue (similar to Stripe deduction)
  // This creates a circular dependency that we solve algebraically:
  //
  // Let:
  //   PF = processingFeeRevenue = PF_fixed + (TOV * PF_pct)
  //   TOV = totalOrderValue = (FA + PF + 0.3) / 0.971
  //   FA = finalAmount
  //   PF_fixed = eventDetail["Processing Fee $"] || 0
  //   PF_pct = eventDetail["Processing Fee %"] || 0
  //
  // Substituting PF into TOV:
  //   TOV = (FA + PF_fixed + (TOV * PF_pct) + 0.3) / 0.971
  //   TOV * 0.971 = FA + PF_fixed + (TOV * PF_pct) + 0.3
  //   TOV * 0.971 - TOV * PF_pct = FA + PF_fixed + 0.3
  //   TOV * (0.971 - PF_pct) = FA + PF_fixed + 0.3
  //   TOV = (FA + PF_fixed + 0.3) / (0.971 - PF_pct)
  
  const processingFeeFixed = eventDetail["Processing Fee $"] || 0;
  const processingFeePct = eventDetail["Processing Fee %"] || 0;
  
  // Calculate totalOrderValue accounting for processing fee percentage on totalOrderValue
  // Formula: TOV = (FA + PF_fixed + 0.3) / (0.971 - PF_pct)
  const denominator = 0.971 - processingFeePct;
  if (denominator <= 0) {
    throw new Error(`Invalid processing fee percentage: ${processingFeePct}. Denominator would be ${denominator}`);
  }
  
  const totalOrderValue =
    (finalAmount + processingFeeFixed + 0.3) / denominator;

  // Processing fee revenue is calculated on totalOrderValue
  const processingFeeRevenue =
    processingFeeFixed +
    (totalOrderValue * processingFeePct);

  // Stripe deduction is calculated on totalOrderValue
  const desiredNet = finalAmount + processingFeeRevenue;
  const stripeDeduction = totalOrderValue - desiredNet;

  console.log("Processing Fee $ (event):", money(eventDetail["Processing Fee $"]));
  console.log("Processing Fee % (event):", eventDetail["Processing Fee %"]);
  console.log("Processing Fee Revenue:", money(processingFeeRevenue));
  console.log("Stripe Deduction (2.9% + 0.30):", money(stripeDeduction));

  logSection("TOTALS");

  console.log("Ticket Count:", ticketCount);
  console.log("Gross Amount (before discount):", money(grossAmount));
  console.log("Final Amount (after discount):", money(finalAmount));
  console.log("Discount Total (calculated):", money(discountTotal));
  console.log("Discount Amount (from Bubble):", order["Discount Amount"] || "N/A");
  console.log("Bubble Gross Amount:", order["Gross Amount"] || "N/A");
  console.log("Calculated Gross Amount:", money(grossAmount));
  console.log("Difference in discount (Bubble - Calculated):", money((order["Discount Amount"] || 0) - discountTotal));
  console.log("Total Order Value:", money(totalOrderValue));

  logSection("ORDER CALCULATION END");

  return {
    ticketCount,
    grossAmount,
    discountTotal,
    processingFeeRevenue,
    stripeDeduction,
    totalOrderValue
  };
}

module.exports = { calculateOrder };
