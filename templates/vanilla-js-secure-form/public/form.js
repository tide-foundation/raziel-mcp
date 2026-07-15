// Protected form submission.
// Sends data to a backend API with the Tide JWT in the Authorization header.
//
// IMPORTANT: This client-side code does NOT enforce authorization.
// Your backend must verify the JWT server-side before processing the submission.
// Without server-side verification, anyone can call the API directly.

const form = document.getElementById("secure-form");
const result = document.getElementById("form-result");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const iam = window.__tideIAM;
  if (!iam || !iam.isAuthenticated()) {
    result.textContent = "Not authenticated. Please login first.";
    return;
  }

  const token = await iam.getToken();
  const name = document.getElementById("name-input").value;
  const email = document.getElementById("email-input").value;

  try {
    // Replace with your actual backend API URL.
    // The backend MUST verify this JWT server-side.
    const res = await fetch("http://localhost:4000/api/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, email }),
    });

    if (!res.ok) {
      result.textContent = `Server returned ${res.status}. Is your backend running?`;
      return;
    }

    const data = await res.json();
    result.textContent = `Submitted: ${JSON.stringify(data)}`;
  } catch (err) {
    result.textContent = `Error: ${err.message}`;
  }
});
