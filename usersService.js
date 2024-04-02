import crypto from "crypto";
import jwt from "jsonwebtoken";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const client = new DynamoDBClient();
const ebClient = new EventBridgeClient();
const docClient = DynamoDBDocumentClient.from(client);
let res = {
  headers: {},
  statusCode: 0,
  body: {},
};

export const userLogIn = async (event) => {
  console.log("userLogIn invoked...");
  const { email, password } = event.body;

  // Validates user input
  if (!email || !password) {
    res.statusCode = 400;
    res.body = JSON.stringify({ message: "Invalid Email or Password" });
    return res;
  }

  // Finds user info
  const getDataResponse = await userGetData({ email: email });
  const user = JSON.parse(getDataResponse.body);

  if (!user || !user.Item) {
    res.statusCode = 401;
    res.body = JSON.stringify({ message: "Unauthorized" });
    return res;
  }

  // Validates user password
  if (!bcrypt.compareSync(password, user.Item.password)) {
    res.statusCode = 400;
    res.body = JSON.stringify({ message: "Unauthorized" });
    return res;
  }

  // Creates access token to be saved in the client's memory
  const accessToken = jwt.sign(
    {
      userId: user.Item.uuid,
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY_TIME }
  );

  // Creates refresh token to be saved in a cookie
  const refreshToken = jwt.sign(
    {
      userId: user.Item.uuid,
    },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY_TIME }
  );

  // Creates a secure cookie containing refresh toke
  // Return user data excluding sensitive info

  const userInfo = user.Item;
  userInfo.password = null;
  userInfo.uuid = null;

  res.headers[
    "Set-Cookie"
  ] = `refresh_token=${refreshToken}; Path=/; HttpOnly; Secure; SameSite=none; Max-Age=${process.env.REFRESH_TOKEN_EXPIRY_TIME_NUMBER}; Partitioned;`;
  res.body = JSON.stringify({ accessToken: accessToken, user: userInfo });
  res.statusCode = 200;
  console.log("Returning refresh token");
  console.log(res);
  return res;
};

export const userRefresh = async (event) => {
  console.log("userRefresh invoked");
  console.log(event);

  // Evaluates cookie existence
  const cookie = event.cookie;

  if (!cookie) {
    res.statusCode = 401;
    res.body = JSON.stringify({ message: "Unauthorized" });
    return res;
  }

  // Parse cookie to get refresh token
  const refreshToken = cookie.split("=")[1];

  try {
    const verify = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    // Finds user info
    const getDataResponse = await userGetData(verify);
    const user = JSON.parse(getDataResponse.body);

    if (!user || !user.Items) {
      res.statusCode = 401;
      res.body = JSON.stringify({ message: "Unauthorized" });
      return res;
    }

    // Generates new access token
    const accessToken = jwt.sign(
      {
        userId: user.Items.email,
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY_TIME }
    );

    const userInfo = user.Items[0];
    userInfo.password = null;
    userInfo.uuid = null;

    res.statusCode = 200;
    res.body = JSON.stringify({ accessToken: accessToken, user: userInfo });
    console.log("Refresh done. Returning 200");
    return res;
  } catch (e) {
    res.statusCode = 403;
    res.body = JSON.stringify({ message: "Forbidden" });
    return res;
  }
};

export const userLogOut = async (event) => {
  console.log("User Log Out Invoked");
  console.log(event);
  const refreshToken = event.cookie;
  if (!refreshToken) {
    console.log("Failed... returning error");
    res.statusCode = 204;
    res.body = JSON.stringify({ message: "No content" });
    return res;
  }
  res.statusCode = 200;

  (res.headers[
    "Set-Cookie"
  ] = `refresh_token=; Path=/; HttpOnly; Secure; SameSite=none; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Partitioned;`),
    (res.body = JSON.stringify({ message: "Cookie cleared" }));
  console.log("final res");
  console.log(res);
  return res;
};

export const userSignUp = async (event) => {
  if (JSON.parse((await userGetData(event.body)).body).Item) {
    res.statusCode = 401;
    res.body = JSON.stringify({ message: "User already exists!" });
    return res;
  }

  const encryptedPassword = bcrypt.hashSync(event.body.password, 10);

  const command = new PutItemCommand({
    TableName: process.env.DYNAMODB_TABLE_USERS,
    Item: marshall({
      ...event.body,
      password: encryptedPassword,
      uuid: crypto.randomUUID(),
      isAdmin: false,
      reviews: {},
    }),
  });

  // Sending to the eventbridge to update the Carts table
  const cartsParams = {
    Entries: [
      {
        Source: process.env.EVENT_SOURCE2,
        Detail: JSON.stringify({ email: event.body.email }),
        DetailType: process.env.EVENT_DETAILTYPE2,
        Resources: [],
        EventBusName: process.env.EVENT_BUSNAME,
      },
    ],
  };

  await ebClient.send(new PutEventsCommand(cartsParams));

  // Sending to the eventbridge to update the Orders table
  const ordersParams = {
    Entries: [
      {
        Source: process.env.EVENT_SOURCE2,
        Detail: JSON.stringify({ email: event.body.email }),
        DetailType: process.env.EVENT_DETAILTYPE3,
        Resources: [],
        EventBusName: process.env.EVENT_BUSNAME,
      },
    ],
  };

  await ebClient.send(new PutEventsCommand(ordersParams));

  try {
    const response = await client.send(command);
    res.statusCode = 200;
    res.body = JSON.stringify({ message: "Sign-Up Successful" });
    return res;
  } catch (e) {
    res.statusCode = 500;
    res.body = JSON.stringify({ message: "Server Error" });
    return res;
  }
};

export const userGetData = async (input) => {
  console.log("UserGetData invoked...");
  console.log(input);
  if (!input || (!input.email && !input.userId)) {
    res.statusCode = 400;
    res.body = JSON.stringify({ message: "Invalid Email or Password" });
    return res;
  }

  let command;

  if (input.email) {
    command = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE_USERS,
      Key: {
        email: input.email,
      },
    });
  } else if (input.userId) {
    command = new ScanCommand({
      TableName: process.env.DYNAMODB_TABLE_USERS,
      FilterExpression: "#uuidAlias = :uuidValue",
      ExpressionAttributeNames: {
        "#uuidAlias": "uuid",
      },
      ExpressionAttributeValues: {
        ":uuidValue": input.userId,
      },
    });
  }

  try {
    const response = await docClient.send(command);

    res.statusCode = 200;
    res.body = JSON.stringify(response);
  } catch (e) {
    console.log(e);
    res.statusCode = 500;
    res.body = JSON.stringify({ message: "Server Error" });
  } finally {
    console.log(res);
    return res;
  }
};

export const userUpdate = async (event) => {
  console.log("userUpdate ", event);
  try {
    // Validates user input
    if (
      !event.body ||
      !event.body.email ||
      !event.body.password ||
      !event.body.newPassword ||
      !event.body.confirmNewPassword ||
      !event.body.firstName ||
      !event.body.lastName ||
      !event.body.phone ||
      !event.body.address
    ) {
      res.statusCode = 400;
      res.body = JSON.stringify({ message: "Invalid Email or Password" });
      return res;
    }

    // Finds user info
    const userResponse = await userGetData({ email: event.body.email });
    const user = JSON.parse(userResponse.body);

    if (!user || !user.Item) {
      res.statusCode = 401;
      res.body = JSON.stringify({ message: "Unauthorized" });
      return res;
    }

    // Validates user password
    if (!bcrypt.compareSync(event.body.password, user.Item.password)) {
      res.statusCode = 400;
      res.body = JSON.stringify({ message: "Unauthorized" });
      return res;
    }

    // Generates new encrypted password
    const encryptedPassword = bcrypt.hashSync(event.body.newPassword, 10);

    // Updates table
    const command = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE_USERS,
      Key: {
        email: event.body.email,
      },
      UpdateExpression:
        "set password = :v_password, firstName = :v_firstName, lastName = :v_lastName, address = :v_address, phone = :v_phone",
      ExpressionAttributeValues: {
        ":v_password": encryptedPassword,
        ":v_firstName": event.body.firstName,
        ":v_lastName": event.body.lastName,
        ":v_address": event.body.address,
        ":v_phone": event.body.phone,
      },
      ReturnValues: "ALL_NEW",
    });

    const response = await docClient.send(command);

    res.statusCode = 200;
    res.body = JSON.stringify({ message: "Update Successful" });
    return res;
  } catch (e) {
    console.log(e);
    res.statusCode = 500;
    res.body = JSON.stringify({ message: "Server Error" });
    return res;
  }
};

export const userReviewUpdate = async (event) => {
  console.log("userReviewUpdate invoked... ", event);

  if (!event || !event.body) {
    res.statusCode = 400;
    res.body = JSON.stringify({ message: "Invalid" });
    return res;
  }

  const {
    email,
    title,
    rating,
    description,
    prodId,
    fullName,
    imageURL,
    prodName,
  } = event.body;

  try {
    const getUserCommand = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE_USERS,
      Key: {
        email: email,
      },
    });
    const getUserResponse = await docClient.send(getUserCommand);
    getUserResponse.Item.reviews[prodId] = {
      title,
      rating,
      description,
      date: new Date().toLocaleString("en-AU", {
        timeZone: "Australia/Sydney",
        timeZoneName: "short",
        hour12: false,
      }),
      fullName,
      imageURL,
      prodName,
    };

    const updateCommand = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE_USERS,
      Key: {
        email: email,
      },
      UpdateExpression: "set reviews = :v_reviews",
      ExpressionAttributeValues: {
        ":v_reviews": getUserResponse.Item.reviews,
      },
      ReturnValues: "ALL_NEW",
    });

    const updateResponse = await docClient.send(updateCommand);

    // Sending to the eventbridge
    const params = {
      Entries: [
        {
          Source: process.env.EVENT_SOURCE1,
          Detail: JSON.stringify(event.body),
          DetailType: process.env.EVENT_DETAILTYPE1,
          Resources: [],
          EventBusName: process.env.EVENT_BUSNAME,
        },
      ],
    };

    const data = await ebClient.send(new PutEventsCommand(params));
    res.statusCode = 200;
    res.body = JSON.stringify({ message: "Update Successful" });
  } catch (e) {
    console.log(e);
    res.statusCode = 500;
    res.body = JSON.stringify({ message: "Server Error" });
  } finally {
    return res;
  }
};
