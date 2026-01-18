import { Routes, Route } from "react-router-dom";
import CallScreen from "./CallScreen";
import HomeAlt from "./HomeAlt";

function RouteList() {
  return (
    <Routes>
      <Route path="/" element={<HomeAlt />} />
      <Route path="/call/:username/:room" element={<CallScreen />} />
    </Routes>
  );
}

export default RouteList;