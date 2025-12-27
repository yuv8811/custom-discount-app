import { data } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
    const { admin } = await authenticate.public.appProxy(request);

    const body = await request.json();
    const { code, cartTotal } = body;

    if (!code) {
        return data({ error: "No code provided" }, { status: 400 });
    }

    const url = new URL(request.url);
    const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");
    console.log("Logged In Customer ID:", loggedInCustomerId);

    console.log("--- Starting Gift Card Validation for code:", code, "---");
    let giftCards = [];
    try {
        console.log("Fetching gift cards from Admin API (limit 250)...");
        const gcResponse = await admin.graphql(
            `#graphql
            query getGiftCards {
              giftCards(first: 250, reverse: true) {
                edges {
                  node {
                    id
                    lastCharacters
                    enabled
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

        if (gcData.errors) {
            console.error("GraphQL Errors in GC Search:", JSON.stringify(gcData.errors, null, 2));
        } else {
            giftCards = gcData.data?.giftCards?.edges || [];
            console.log(`Successfully fetched ${giftCards.length} gift cards.`);
        }
    } catch (err) {
        console.error("Failed to fetch gift cards:", err);
    }

    const normalizedCode = code ? code.replace(/\s+/g, '').toUpperCase() : "";
    console.log("Normalized Input Code:", normalizedCode);

    const matchingGC = giftCards.find(({ node }) => {
        if (!node) return false;

        if (!node.enabled) return false;
        if (!node.lastCharacters) return false;

        const lastChars = node.lastCharacters.toUpperCase();

        const endsWithMatch = normalizedCode.endsWith(lastChars);
        const explicitMatch = normalizedCode === `GIFT-${lastChars}`;

        const matches = endsWithMatch || explicitMatch;

        if (matches) {
            console.log(`[Strict Match Found] Card ID: ${node.id}, LastChars: ${lastChars}, Customer: ${node.customer?.id || 'None'}`);

            const giftCardCustomerId = node.customer?.id ? node.customer.id.split('/').pop() : null;

            console.log(`[GC Debug] Comparing GC Customer ${giftCardCustomerId} with LoggedIn Customer ${loggedInCustomerId}`);

            if (giftCardCustomerId && giftCardCustomerId !== loggedInCustomerId) {
                console.log(`[GC Debug] Customer mismatch! Rejecting gift card.`);
                return false;
            }

            return true;
        }

        return false;
    });


    if (matchingGC) {
        const gc = matchingGC.node;
        const balance = parseFloat(gc.balance.amount);
        const amountToApply = Math.min(balance, (cartTotal / 100));

        const targetDiscountCode = normalizedCode;

        const checkExistingResponse = await admin.graphql(
            `#graphql
            query checkDiscount($code: String!) {
              codeDiscountNodeByCode(code: $code) {
                id
                codeDiscount {
                   ... on DiscountCodeBasic {
                     status
                   }
                }
              }
            }`,
            { variables: { code: targetDiscountCode } }
        );
        const existingData = await checkExistingResponse.json();

        if (existingData.data?.codeDiscountNodeByCode) {
            console.log(`Discount code ${targetDiscountCode} already exists. Reusing it.`);
            return data({
                valid: true,
                type: "gift_card",
                appliedAmount: amountToApply,
                totalBalance: balance,
                newBalance: balance - amountToApply,
                discountCode: targetDiscountCode,
                currency: gc.balance.currencyCode,
                message: `Applied ${gc.balance.currencyCode} ${amountToApply.toFixed(2)} from your gift card.`
            });
        }

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
                            code: targetDiscountCode,
                            startsAt: new Date(Date.now() - 60000).toISOString(),
                            endsAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // Valid for 1 hour
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
                            appliesOncePerCustomer: false
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
                    totalBalance: balance,
                    newBalance: balance - amountToApply,
                    discountCode: targetDiscountCode,
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

export const loader = async ({ request }) => {
    return data({ message: "Storefront API proxy is active" });
};

