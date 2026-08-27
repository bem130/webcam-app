import { render } from "preact";
import { App } from "./ui/app";
import "./styles/app.css";

const root = document.getElementById("app");
if (root === null) throw new Error("App root was not found");
render(<App />, root);

