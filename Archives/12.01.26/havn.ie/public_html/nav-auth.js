/* HAVN nav auth controller
   Expected ids (if present):
   - navAddListing
   - navMyListings
   - navLogin
   - navLogout

   Behavior:
   - Logged OUT: show Login, hide Add + My + Logout
   - Logged IN: show Add + My + Logout, hide Login
*/

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function setVisible(el, on) {
    if (!el) return;
    el.style.display = on ? "" : "none";
  }

  function apply() {
    const loggedIn = window.HAVN_AUTH && window.HAVN_AUTH.isLoggedIn && window.HAVN_AUTH.isLoggedIn();

    const add = $("navAddListing");
    const mine = $("navMyListings");
    const login = $("navLogin");
    const logout = $("navLogout");

    setVisible(add, !!loggedIn);
    setVisible(mine, !!loggedIn);
    setVisible(logout, !!loggedIn);
    setVisible(login, !loggedIn);

    if (logout) {
      logout.addEventListener("click", (e) => {
        e.preventDefault();
        if (window.HAVN_AUTH && window.HAVN_AUTH.clearToken) window.HAVN_AUTH.clearToken();
        window.location.href = "index.html";
      }, { once: true });
    }
  }

  document.addEventListener("DOMContentLoaded", apply);
})();
