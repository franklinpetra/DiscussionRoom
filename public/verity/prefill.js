// Added by this site: a question linked from elsewhere arrives as ?q=.
const question = new URLSearchParams(location.search).get("q");
const box = document.getElementById("decision");
if (question && box && !box.value) {
  box.value = question.slice(0, Number(box.maxLength) > 0 ? Number(box.maxLength) : 4000);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}
