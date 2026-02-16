const { money, logSection } = require("./logger");

// Helper function to round to 2 decimal places
function roundTo2(num) {
  return Math.round(num * 100) / 100;
}

function calculateOrder({
  order,
  addOns,
  promotion,
  ticketTypes,
  eventDetail,
  customFeeTypes = {},
  orderFees = []
}) {
  let ticketCount = 0;
  // Gross amount is (ticket price * qty) only - does NOT include service fees
  let grossAmount = 0;
  // Final amount is (ticket price * qty + service fee - discount) AFTER discount deduction
  let finalAmount = 0;
  let discountTotal = 0;
  let totalServiceFee = 0; // Track total service fee across all addOns
  let donationTotal = 0; // Track total donations
  let totalCustomFees = 0; // Track total custom fees
  let discountAppliedToOrder = false; // Track if discount has been applied to this order
  
  // Track final prices per addOn for custom fee calculation
  const addOnFinalPrices = {};

  logSection("ORDER CALCULATION START");

  // console.log("ED PF TOGGLE", eventDetail["No Processing Fee"]);
  // console.log("Order ID:", order._id);
  console.log("Promotion:", promotion ? `${promotion._id} (Type: ${promotion["OS GP Promotion Type"]}, Amount: ${promotion.DiscountAmt || "N/A"}, Pct: ${promotion.DiscountPct || "N/A"})` : "None");

addOns.forEach((addOn, index) => {
  // Handle Donation addOns separately
  if (addOn["OS AddOnType"] === "Donation") {
    // Donation amount is stored in "Gross Price" or "Final Price" field
    const donationAmount = addOn["Gross Price"] || addOn["Final Price"] || 0;
    donationTotal += donationAmount;
    console.log(`\nAddOn #${index + 1} (Donation)`);
    console.log("AddOn ID:", addOn._id);
    console.log("Donation Amount:", money(donationAmount));
    return;
  }

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
  
  // Get service fee per ticket from GP_TicketType, default to 2 if not specified
  // However, if ticket price is 0, service fee is also 0
  const serviceFeePerTicket = ticketPrice === 0 ? 0 : (ticketType["Service Fee"] || 2);

  ticketCount += qty;

  const serviceFee = serviceFeePerTicket * qty;
  totalServiceFee += serviceFee;

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

  const addOnTicketTotal = ticketPrice * qty;
  const addOnGross = addOnTicketTotal + serviceFee;
  const addOnFinal = addOnGross - discount;

  grossAmount += addOnTicketTotal; // Gross amount excludes service fees
  finalAmount += addOnFinal;
  
  // Store final price for this addOn (for custom fee calculation)
  addOnFinalPrices[addOn._id] = addOnFinal;

  console.log(`\nAddOn #${index + 1} (Ticket)`);
  console.log("AddOn ID:", addOn._id);
  console.log("Qty:", qty);
  console.log("Ticket Price:", money(ticketPrice));
  console.log("Service Fee per Ticket:", money(serviceFeePerTicket));
  console.log("Service Fee (total):", money(serviceFee));
  console.log("Discount:", money(discount));
  console.log("AddOn Ticket Total (gross, no service fee):", money(addOnTicketTotal));
  console.log("AddOn Gross (ticket + service fee, before discount):", money(addOnGross));
  console.log("AddOn Final (after discount):", money(addOnFinal));
});

  // Calculate custom fees for each Ticket addOn
  // Custom fees are calculated after discounts are applied
  logSection("CUSTOM FEES");
  
  const ticketAddOns = addOns.filter(addOn => addOn["OS AddOnType"] === "Ticket");
  
  if (Object.keys(customFeeTypes).length > 0 && ticketAddOns.length > 0) {
    console.log(`Calculating custom fees for ${ticketAddOns.length} ticket addOn(s)`);
    
    // Count valid ticket addOns (those with non-zero final price)
    const validTicketAddOns = ticketAddOns.filter(addOn => {
      const addOnFinalPrice = addOnFinalPrices[addOn._id] || 0;
      return addOnFinalPrice !== 0 && Math.abs(addOnFinalPrice) >= 0.01;
    });
    const validAddOnCount = validTicketAddOns.length;
    
    // For each custom fee type
    Object.values(customFeeTypes).forEach(customFeeType => {
      const feeType = customFeeType.Type; // "Percentage" or "Fixed"
      const feeAmount = customFeeType["Fee Amount"] || 0;
      
      console.log(`\nCustom Fee Type: ${customFeeType._id}`);
      console.log(`  Type: ${feeType}`);
      console.log(`  Fee Amount: ${feeAmount}`);
      
      // For Fixed fees, divide the amount across all valid ticket addOns
      const fixedFeePerAddOn = feeType === "Fixed" && validAddOnCount > 0 
        ? feeAmount / validAddOnCount 
        : feeAmount;
      
      // For each Ticket addOn, calculate the custom fee
      ticketAddOns.forEach(addOn => {
        const addOnFinalPrice = addOnFinalPrices[addOn._id] || 0;
        
        // If ticket total is $0, no fees will be added
        if (addOnFinalPrice === 0 || Math.abs(addOnFinalPrice) < 0.01) {
          console.log(`  AddOn ${addOn._id}: Final price is 0, skipping custom fee`);
          return;
        }
        
        let customFeeAmount = 0;
        
        if (feeType === "Percentage") {
          // Percentage: Fee Amount is already divided by 100, calculate on Final Price
          customFeeAmount = addOnFinalPrice * feeAmount;
        } else if (feeType === "Fixed") {
          // Fixed: Fee Amount is divided across all valid ticket addOns
          customFeeAmount = fixedFeePerAddOn;
        }
        
        totalCustomFees += customFeeAmount;
        
        console.log(`  AddOn ${addOn._id}: Final Price = ${money(addOnFinalPrice)}, Custom Fee = ${money(customFeeAmount)}`);
      });
    });
    
    console.log(`\nTotal Custom Fees: ${money(totalCustomFees)}`);
  } else {
    console.log("No custom fees to calculate");
  }

  logSection("FEES");

  // Check if processing fees should be excluded
  const noProcessingFee = eventDetail["No Processing Fee"] === true || eventDetail["No Processing Fee"] === "Yes";
  
  // Check if base amount is 0 - if so, no processing fees apply
  const baseAmount = finalAmount + donationTotal;
  const isZeroOrder = baseAmount === 0 || Math.abs(baseAmount) < 0.01;
  
  let processingFeeRevenue = 0;
  let totalOrderValue;
  let stripeDeduction;

  if (isZeroOrder) {
    // If total order value is 0, no processing fees apply
    console.log("Total Order Value is 0 - No processing fees applied");
    totalOrderValue = 0;
    processingFeeRevenue = 0;
    stripeDeduction = 0;
  } else if (noProcessingFee) {
    // When "No Processing Fee" is true:
    // - Processing fee revenue is 0
    // - Total order value does NOT include processing fees
    // - Stripe deduction is still calculated on totalOrderValue (which includes donations)
    console.log("No Processing Fee: true - Processing fees excluded from total order value");

    // In "No Processing Fee" mode, Bubble's Total Order Value excludes processing fees
    // AND does not get "grossed up" to cover Stripe. The customer pays the finalAmount,
    // and Stripe deduction is calculated separately on that charged amount.
    // Donations and custom fees are added to totalOrderValue but NOT included in processingFeeRevenue calculation
    totalOrderValue = finalAmount + donationTotal + totalCustomFees;

    // Stripe deduction is calculated on the charged total (including donations).
    stripeDeduction = (totalOrderValue * 0.029) + 0.3;
  } else {
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
    // IMPORTANT: Processing fee is calculated on tickets portion only, NOT including donations
    // But Stripe deduction is calculated on the total (including donations)
    //
    // Strategy:
    // 1. Calculate base order value for tickets (with processing fees, grossed up for Stripe)
    // 2. Add donations to get total order value
    // 3. Calculate Stripe deduction on the total (including donations)
    const denominator = 0.971 - processingFeePct;
    if (denominator <= 0) {
      throw new Error(`Invalid processing fee percentage: ${processingFeePct}. Denominator would be ${denominator}`);
    }
    
    // New approach: Calculate total processing fee (PFD + PFR combined)
    // PFD = Processing Fee Deduction (Stripe: 2.9% + $0.30)
    // PFR = Processing Fee Revenue (8count's fee: fixed $ + percentage)
    
    // Step 1: Calculate donation fee separately
    // Formula: ((Donation Amount + 0) / (1 - PFD%)) × PFD %
    // PFD% = 0.029 (Stripe's 2.9%)
    const donationFee = roundTo2((donationTotal / (1 - 0.029)) * 0.029);
    console.log("Donation Fee (calculated separately):", money(donationFee));
    
    // Step 2: Calculate base for total processing fee
    // Base = [Order total (tickets+service-discounts) + (PFD $ + PFR $) + Custom Fees] / [1 - (PFD % + PFR %)]
    // Order total = finalAmount (tickets + service fees - discounts)
    // PFD $ = 0.30 (Stripe's fixed fee)
    // PFR $ = processingFeeFixed
    // PFD % = 0.029
    // PFR % = processingFeePct
    const combinedPercentage = 0.029 + processingFeePct; // PFD % + PFR %
    const combinedFixed = 0.30 + processingFeeFixed; // PFD $ + PFR $
    const baseDenominator = 1 - combinedPercentage;
    
    if (baseDenominator <= 0) {
      throw new Error(`Invalid combined processing fee percentage: ${combinedPercentage}. Denominator would be ${baseDenominator}`);
    }
    
    const base = (finalAmount + combinedFixed + totalCustomFees) / baseDenominator;
    
    // Step 3: Calculate total processing fee
    // Total processing fee = Base × (PFD % + PFR %) + (PFD $ + PFR $) + donation_fee
    const totalProcessingFee = roundTo2(
      (base * combinedPercentage) + combinedFixed + donationFee
    );
    console.log("Base (for total processing fee):", money(base));
    console.log("Total Processing Fee (PFD + PFR + donation fee):", money(totalProcessingFee));
    
    // Step 4: Total order value = finalAmount + totalCustomFees + totalProcessingFee + donationTotal
    totalOrderValue = finalAmount + totalCustomFees + totalProcessingFee + donationTotal;
    
    // Step 5: Stripe deduction (PFD) on total order value (amount charged to customer)
    // Bubble: round the percentage part first, then add fixed fee
    const pfdPercentagePart = roundTo2(totalOrderValue * 0.029);
    stripeDeduction = pfdPercentagePart + 0.30;
    console.log("PFD (on total order value):", money(stripeDeduction));
    
    // Step 6: Processing Fee Revenue = Total processing fee - PFD (do not round)
    processingFeeRevenue = totalProcessingFee - stripeDeduction;
    console.log("PFR (Total processing fee - PFD):", money(processingFeeRevenue));
  }

  console.log("No Processing Fee:", noProcessingFee ? "Yes" : "No");
  console.log("Processing Fee $ (event):", money(eventDetail["Processing Fee $"]));
  console.log("Processing Fee % (event):", eventDetail["Processing Fee %"]);
  console.log("Processing Fee Revenue:", money(processingFeeRevenue));
  console.log("Stripe Deduction (2.9% + 0.30):", money(stripeDeduction));

  logSection("TOTALS");

  console.log("Ticket Count:", ticketCount);
  console.log("Total Service Fee:", money(totalServiceFee));
  console.log("Donation Total:", money(donationTotal));
  console.log("Total Custom Fees:", money(totalCustomFees));
  console.log("Gross Amount (ticket revenue only, no service fees):", money(grossAmount));
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
    totalServiceFee,
    donationTotal,
    totalCustomFees,
    discountTotal,
    processingFeeRevenue,
    stripeDeduction,
    totalOrderValue
  };
}

module.exports = { calculateOrder };
