import {
  userLogIn,
  userGetData,
  userLogOut,
  userSignUp,
  userUpdate,
  userRefresh,
  userReviewUpdate,
} from "./usersService.js";

export const handler = async (event) => {
  console.log("Handler invoked...");
  console.log(event);

  try {
    switch (event.httpMethod) {
      case "GET":
        if (event.querystring != "{}") {
          const str = event.querystring.split("=")[1];
          const email = str.split("}")[0];
          return await userGetData({
            email: email,
          });
        } else if (event.path == "/users") {
          return await userLogOut(event);
        }
        break;
      case "POST":
        if (event.path == "/users") {
          return await userLogIn(event);
        } else if (event.path == "/users/signup") {
          return await userSignUp(event);
        } else if (event.path == "/users/refresh") {
          return await userRefresh(event);
        } else if (event.path == "/users/update") {
          return await userUpdate(event);
        } else if (event.path == "/users/reviews") {
          return await userReviewUpdate(event);
        }
        break;
      default:
        throw new Error("Invalid access");
    }
  } catch (e) {
    return e;
  }
};
