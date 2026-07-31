package server

import (
	"log"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
)

// How much memory this process may actually use, and what that means for the
// expensive work it is allowed to take on.
//
// The trap this exists for: inside a container, /proc/meminfo reports the
// HOST's memory. A container capped at 512 MB on a 64 GB machine believes it
// has 64 GB, sizes its work accordingly, and gets killed by the first large
// document. The cgroup files below are the only place the real cap is written.

// availableMemory returns the memory ceiling in bytes, or 0 when it cannot be
// determined. cgroup v2 first (every current runtime), then v1.
func availableMemory() int64 {
	for _, p := range []string{
		"/sys/fs/cgroup/memory.max",                   // cgroup v2
		"/sys/fs/cgroup/memory/memory.limit_in_bytes", // cgroup v1
	} {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		s := strings.TrimSpace(string(b))
		// v2 writes "max" when unlimited; v1 writes a number so large it means
		// the same thing. Both mean "no container cap" — fall through to the
		// host figure.
		if s == "max" {
			break
		}
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil || n <= 0 || n > 1<<50 {
			break
		}
		return n
	}
	return hostMemory()
}

// hostMemory reads the machine's total memory from /proc/meminfo. Linux only,
// which is where Salt.md is deployed; elsewhere (a developer's Mac) it returns
// 0 and every caller falls back to its conservative default. Guessing a figure
// would be worse than admitting we do not know one.
func hostMemory() int64 {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		f := strings.Fields(line) // "MemTotal:", "16777216", "kB"
		if len(f) < 2 {
			return 0
		}
		kb, err := strconv.ParseInt(f[1], 10, 64)
		if err != nil {
			return 0
		}
		return kb << 10
	}
	return 0
}

// applyMemoryLimit tells the garbage collector where the ceiling is instead of
// letting it guess. Without this the collector sizes itself against the host's
// memory and lets the heap grow past a container cap — it collects too late,
// and the kernel gets there first. 80% leaves room for everything that is not
// Go heap (stacks, the SQLite library, file buffers).
func applyMemoryLimit() {
	avail := availableMemory()
	if avail <= 0 {
		return
	}
	debug.SetMemoryLimit(avail / 100 * 80)
	log.Printf("memory: %d MB available, soft limit %d MB, PDF indexing up to %d MB, %d extraction(s) at a time",
		avail>>20, (avail/100*80)>>20, pdfExtractLimit()>>20, extractionSlots())
}

// pdfExtractLimit is the largest PDF whose text we are willing to build in
// memory. A parser allocates a multiple of the file's size for its object
// tree, and the server has to keep answering everything else meanwhile — hence
// a hundredth of what is available, not a half.
//
// This scales automatically because getting it wrong is only ever a graceful
// degradation: the file is still stored, still listed, still downloadable, and
// only its text stays out of the search index. Never a failed upload, so
// nobody is left wondering why the same file behaved differently on two
// machines. The upload limit itself deliberately does NOT scale — see
// maxUploadBytes.
func pdfExtractLimit() int64 { return extractLimitFor(availableMemory()) }

// extractLimitFor is the arithmetic on its own, so the sizing can be tested
// without a container: the detection reads files that exist only on Linux, but
// the rule they feed has to hold everywhere.
func extractLimitFor(avail int64) int64 {
	if avail <= 0 {
		return 10 << 20 // unknown machine: the conservative default
	}
	limit := avail / 100
	if limit < 5<<20 {
		return 5 << 20
	}
	if limit > 50<<20 {
		return 50 << 20
	}
	return limit
}

// extractionSlots is how many PDFs may be parsed at the same time. This is the
// axis that gets forgotten: one 15 MB extraction is harmless, four at once are
// not, and any per-file limit is worthless while ten uploads run in parallel.
// Queueing costs a little waiting; not queueing costs the server.
func extractionSlots() int { return extractionSlotsFor(availableMemory()) }

func extractionSlotsFor(avail int64) int {
	switch {
	case avail <= 0 || avail < 4<<30:
		return 1
	case avail < 12<<30:
		return 2
	default:
		return 3
	}
}
