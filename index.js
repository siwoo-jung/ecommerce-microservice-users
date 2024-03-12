import {
  userLogIn,
  userGetData,
  userLogOut,
  userSignUp,
  userChangeData,
} from "./usersService.js";

export const handler = async (event) => {
  // POST /users            Login
  // POST /users/signup     Signup
  // POST /users/:username  changeData

  // GET  /users            Log out
  // GET  /users/:username  getData

  // CORS 확인
  let body;

  try {
    switch (event.httpMethod) {
      case "GET":
        if (event.path == "/users") {
          body = await userLogOut();
        } else if (event.pathParameters) {
          body = await userGetData(event.pathparameters);
        }
      case "POST":
        if (event.path == "/users") {
          body = await userLogIn(event);
        } else if (event.path == "/users/signup") {
          body = await userSignUp(event);
        } else if (event.pathParameters) {
          body = await userChangeData(event.pathparameters);
        }
        break;
      default:
    }
    return {
      headers: {
        "Access-Control-Allow-Headers": "Content-Type,auth_token",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,GET",
      },
      statusCode: 200,
      body: JSON.stringify({
        message: "Operation succeessful",
        body: body,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to perform operation.",
        errorMsg: e.message,
        errorStack: e.stack,
      }),
    };
  }
};
