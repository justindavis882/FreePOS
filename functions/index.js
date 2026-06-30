const functions = require("firebase-functions");
const admin = require("firebase-admin");

const stripe = require("stripe")(functions.config().stripe.secret);

admin.initializeApp();
const db = admin.firestore();

/**
 * FUNCTION 1: Finalize Stripe Connection
 * Takes the OAuth code from the frontend, securely exchanges it with Stripe 
 * for an Account ID, and saves it to the user's FreePOS profile.
 */
exports.finalizeStripeConnection = functions.https.onCall(async (data, context) => {
    // 1. Verify the user is authenticated in FreePOS
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
    }

    const authCode = data.code;
    if (!authCode) {
        throw new functions.https.HttpsError("invalid-argument", "Missing Stripe authorization code.");
    }

    try {
        // 2. Exchange the authorization code for the Stripe Account ID
        const response = await stripe.oauth.token({
            grant_type: "authorization_code",
            code: authCode,
        });

        const connectedAccountId = response.stripe_user_id;

        // 3. Save the connected account ID to the user's config document
        const uid = context.auth.uid;
        await db.collection("users").doc(uid).collection("config").doc("settings").set({
            stripe_account_id: connectedAccountId
        }, { merge: true });

        return { success: true, accountId: connectedAccountId };
    } catch (error) {
        console.error("Stripe OAuth Error:", error);
        throw new functions.https.HttpsError("internal", "Failed to connect Stripe account.");
    }
});

/**
 * FUNCTION 2: Create Payment Intent
 * Calculates the total, deducts the 0.75% FreePOS platform fee, 
 * and tells Stripe to prepare a charge on the connected vendor's account.
 */
exports.createPaymentIntent = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
    }

    const amountToCharge = data.amount; // In cents (e.g., $10.00 = 1000)
    
    if (!amountToCharge || amountToCharge <= 0) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid charge amount.");
    }

    try {
        // 1. Get the vendor's Stripe Account ID from Firestore
        const uid = context.auth.uid;
        const configDoc = await db.collection("users").doc(uid).collection("config").doc("settings").get();
        
        if (!configDoc.exists || !configDoc.data().stripe_account_id) {
            throw new functions.https.HttpsError("failed-precondition", "Stripe not connected.");
        }
        
        const connectedAccountId = configDoc.data().stripe_account_id;

        // 2. Calculate the FreePOS 0.75% Platform Fee
        // Math.round ensures we don't pass fractional cents to Stripe
        const platformFee = Math.round(amountToCharge * 0.0075); 

        // 3. Create the Intent
        const paymentIntent = await stripe.paymentIntents.create({
            payment_method_types: ['card'],
            amount: amountToCharge,
            currency: 'usd',
            application_fee_amount: platformFee, 
        }, {
            stripeAccount: connectedAccountId, // This routes the money to the vendor!
        });

        // 4. Send the client secret back to the frontend to complete the charge
        return { clientSecret: paymentIntent.client_secret };

    } catch (error) {
        console.error("Payment Intent Error:", error);
        throw new functions.https.HttpsError("internal", "Failed to create payment intent.");
    }
});