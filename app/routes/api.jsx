import { data } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
    const { admin } = await authenticate.public.appProxy(request);

    const body = await request.json();
    const { code, cartTotal } = body;

    if (!code) {
        return data({ error: "No code provided" }, { status: 400 });
    }

    // 0. Fetch logged-in customer ID from the request (sent by Shopify App Proxy)
    const url = new URL(request.url);
    const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");
    console.log("Logged In Customer ID:", loggedInCustomerId);

    // 1. Validate the gift card by querying real gift cards from Shopify Admin
    let giftCards = [];
    try {
        const gcResponse = await admin.graphql(
            `#graphql
            query getGiftCards {
              giftCards(first: 50, query: "enabled:true") {
                edges {
                  node {
                    id
                    lastCharacters
                    balance {
                      amount
                      currencyCode
                    }
                    customer {
                      id
                    }
                  }
                }
              }
            }`
        );

        const gcData = await gcResponse.json();
        console.log("Gift Card Search Response:", JSON.stringify(gcData, null, 2));

        if (gcData.errors) {
            console.error("GraphQL Errors in GC Search:", gcData.errors);
        } else {
            giftCards = gcData.data?.giftCards?.edges || [];
        }
    } catch (err) {
        console.error("Failed to fetch gift cards:", err);
    }

    // Clean the input code (remove spaces, etc)
    const normalizedCode = code.replace(/\s+/g, '').toUpperCase();

    const matchingGC = giftCards.find(({ node }) => {
        if (!node || !node.lastCharacters) return false;

        const lastChars = node.lastCharacters.toUpperCase();
        const matches = normalizedCode === `GIFT-${lastChars}` ||
            normalizedCode.endsWith(lastChars);

        if (!matches) return false;

        // MATCH CUSTOMER ID Check
        // Shopify GIDs are like gid://shopify/Customer/12345678
        // url.searchParams.get("logged_in_customer_id") is just the digit part or null
        const giftCardCustomerId = node.customer?.id.split('/').pop() || null;

        console.log(`[GC Debug] Comparing GC Customer ${giftCardCustomerId} with LoggedIn Customer ${loggedInCustomerId}`);

        if (giftCardCustomerId !== loggedInCustomerId) {
            console.log(`[GC Debug] Customer mismatch! Rejecting gift card.`);
            return false;
        }

        console.log(`[GC Debug] Checking "${lastChars}" against "${normalizedCode}": Match=${matches}`);
        return matches;
    });


    if (matchingGC) {
        const gc = matchingGC.node;
        const balance = parseFloat(gc.balance.amount);
        const amountToApply = Math.min(balance, (cartTotal / 100));

        // CREATE A REAL SHOPIFY DISCOUNT
        // This is what actually "mutates" the price at checkout
        const tempCode = `GC-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        try {
            const discountCreateResponse = await admin.graphql(
                `#graphql
                mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
                  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
                    codeDiscountNode {
                      id
                    }
                    userErrors {
                      field
                      message
                    }
                  }
                }`,
                {
                    variables: {
                        basicCodeDiscount: {
                            title: `Gift Card - ${gc.lastCharacters}`,
                            code: tempCode,
                            startsAt: new Date(Date.now() - 60000).toISOString(),
                            endsAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
                            customerSelection: {
                                all: true
                            },
                            customerGets: {
                                value: {
                                    discountAmount: {
                                        amount: amountToApply.toFixed(2).toString(),
                                        appliesOnEachItem: false
                                    }
                                },
                                items: {
                                    all: true
                                }
                            },
                            appliesOncePerCustomer: true
                        }
                    }
                }
            );

            const discountData = await discountCreateResponse.json();
            console.log("Discount Create Response:", JSON.stringify(discountData, null, 2));

            if (discountData.data?.discountCodeBasicCreate?.codeDiscountNode) {
                return data({
                    valid: true,
                    type: "gift_card",
                    appliedAmount: amountToApply,
                    totalBalance: balance, // Add total balance
                    newBalance: balance - amountToApply,
                    discountCode: tempCode,
                    currency: gc.balance.currencyCode,
                    message: `Applied ${gc.balance.currencyCode} ${amountToApply.toFixed(2)} from your gift card.`
                });
            } else {
                const userErrors = discountData.data?.discountCodeBasicCreate?.userErrors;
                console.error("Shopify User Errors:", JSON.stringify(userErrors, null, 2));
                const errorMsg = userErrors?.[0]?.message || "Shopify rejected the discount creation.";
                return data({
                    valid: false,
                    message: `Price mutation failed: ${errorMsg}`
                });
            }
        } catch (err) {
            console.error("Failed to create discount:", err);
            return data({ valid: false, message: "System error creating discount" });
        }
    }

    // 2. Check for standard Shopify Discounts
    const response = await admin.graphql(
        `#graphql
    query checkDiscount($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            status
          }
          ... on DiscountCodeFreeShipping {
            title
            status
          }
          ... on DiscountCodeBxgy {
            title
            status
          }
        }
      }
    }`,
        {
            variables: { code },
        }
    );

    const graphqlData = await response.json();

    // Log for debugging (you'll see this in your terminal)
    console.log("GraphQL Response for code:", code, JSON.stringify(graphqlData, null, 2));

    if (graphqlData.errors) {
        return data({ valid: false, message: "Server error querying code" }, { status: 500 });
    }

    if (graphqlData.data?.codeDiscountNodeByCode?.codeDiscount) {
        const details = graphqlData.data.codeDiscountNodeByCode.codeDiscount;
        if (details.status && details.status !== 'ACTIVE') {
            return data({ valid: false, message: "This code is no longer active" });
        }

        return data({
            valid: true,
            type: "discount",
            details: details,
        });
    }

    return data({ valid: false, message: `Code "${code}" not found or invalid` });
};

// Handle GET requests if needed
export const loader = async ({ request }) => {
    return data({ message: "Storefront API proxy is active" });
};

